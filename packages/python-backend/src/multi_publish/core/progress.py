"""
Progress Callback — 发布进度上报状态机

发布全流程分段上报：upload → push → audit → done。
每段触发:  (stage, percent, message) 三元组。

支持：
1. IPC 广播（Electron 主进程 → 渲染进程）
2. Python 回调（调用方传入 callback）
3. 状态机自动流转

架构参考：参考产品 SetProgressEvent + publishStatusEnum
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any

# ============================================================
# 状态定义
# ============================================================


class PublishStage(StrEnum):
    """发布阶段"""

    INIT = "init"  # 初始化
    PREPARE = "prepare"  # 准备中
    UPLOADING = "uploading"  # 上传中
    UPLOAD_SUCCESS = "uploadSuccess"  # 上传完成
    UPLOAD_FAIL = "uploadFail"  # 上传失败
    PUSHING = "pushing"  # 推送中
    PUSH_SUCCESS = "pushSuccess"  # 推送成功
    PUSH_FAIL = "pushFail"  # 推送失败
    AUDIT_WAITING = "auditWaiting"  # 等待审核
    AUDIT_PASS = "auditPass"  # 审核通过
    AUDIT_DENY = "auditDeny"  # 审核驳回
    COMPLETED = "completed"  # 完成
    FAILED = "failed"  # 失败


STAGE_ORDER = [
    PublishStage.INIT,
    PublishStage.PREPARE,
    PublishStage.UPLOADING,
    PublishStage.UPLOAD_SUCCESS,
    PublishStage.UPLOAD_FAIL,
    PublishStage.PUSHING,
    PublishStage.PUSH_SUCCESS,
    PublishStage.PUSH_FAIL,
    PublishStage.AUDIT_WAITING,
    PublishStage.AUDIT_PASS,
    PublishStage.AUDIT_DENY,
    PublishStage.COMPLETED,
    PublishStage.FAILED,
]

# 各阶段权重（用于计算整体百分比）
STAGE_WEIGHTS: dict[PublishStage, int] = {
    PublishStage.INIT: 0,
    PublishStage.PREPARE: 5,
    PublishStage.UPLOADING: 40,
    PublishStage.UPLOAD_SUCCESS: 50,
    PublishStage.UPLOAD_FAIL: 0,
    PublishStage.PUSHING: 80,
    PublishStage.PUSH_SUCCESS: 90,
    PublishStage.PUSH_FAIL: 0,
    PublishStage.AUDIT_WAITING: 92,
    PublishStage.AUDIT_PASS: 98,
    PublishStage.AUDIT_DENY: 0,
    PublishStage.COMPLETED: 100,
    PublishStage.FAILED: 0,
}


# ============================================================
# 进度事件
# ============================================================


@dataclass
class ProgressEvent:
    """进度事件"""

    task_id: str  # 发布任务 ID
    platform: str  # 平台名称
    stage: PublishStage  # 当前阶段
    percent: int  # 整体进度 (0-100)
    message: str  # 中文描述
    detail: str = ""  # 详细说明
    timestamp: datetime = field(default_factory=datetime.now)

    def to_dict(self) -> dict:
        return {
            "taskId": self.task_id,
            "platform": self.platform,
            "stage": self.stage.value,
            "percent": self.percent,
            "message": self.message,
            "detail": self.detail,
            "timestamp": self.timestamp.isoformat(),
        }


# ============================================================
# 进度上报器
# ============================================================

ProgressCallback = Callable[[ProgressEvent], Any]


class ProgressReporter:
    """
    发布进度上报器

    用法：
        reporter = ProgressReporter(task_id="xxx", platform="weibo")
        reporter.uploading(progress=30, message="上传图片 3/10")
        reporter.pushing(message="正在推送数据")
        reporter.completed(message="发布成功")
    """

    def __init__(
        self,
        task_id: str,
        platform: str,
        callbacks: list[ProgressCallback] | None = None,
    ):
        """
        Args:
            task_id: 发布任务 ID
            platform: 平台名称
            callbacks: 外部回调列表（例如 IPC 发送函数）
        """
        self.task_id = task_id
        self.platform = platform
        self.callbacks = callbacks or []
        self._last_stage: PublishStage | None = None
        self._last_percent: int = 0

    def add_callback(self, callback: ProgressCallback):
        """添加回调"""
        self.callbacks.append(callback)

    def _emit(self, stage: PublishStage, percent: int | None = None, message: str = "", detail: str = ""):
        """
        发出进度事件

        Args:
            stage: 当前阶段
            percent: 整体进度（None 则从 STAGE_WEIGHTS 取默认值）
            message: 用户可见的描述文字
            detail: 详细日志
        """
        if percent is None:
            percent = STAGE_WEIGHTS.get(stage, 0)

        event = ProgressEvent(
            task_id=self.task_id,
            platform=self.platform,
            stage=stage,
            percent=percent,
            message=message,
            detail=detail,
        )

        self._last_stage = stage
        self._last_percent = percent

        # 调用所有回调
        for cb in self.callbacks:
            try:
                cb(event)
            except Exception as e:
                import logging

                logging.getLogger(__name__).error(f"Progress callback error: {e}")

    # ========== 便捷方法 ==========

    def init(self, message: str = "开始发布"):
        """初始化"""
        self._emit(PublishStage.INIT, message=message)

    def prepare(self, message: str = "准备中", detail: str = ""):
        """准备阶段"""
        self._emit(PublishStage.PREPARE, message=message, detail=detail)

    def uploading(self, progress: int = 0, total: int | None = None, message: str = "上传中"):
        """
        上传阶段

        Args:
            progress: 当前进度（例如已上传的分片数）
            total: 总数（例如总分片数）
            message: 描述
        """
        if total and total > 0:
            percent = 5 + int((progress / total) * 45)  # 5~50%
            detail = f"{progress}/{total}"
        else:
            percent = 25
            detail = ""

        self._emit(PublishStage.UPLOADING, percent=percent, message=message, detail=detail)

    def upload_success(self, message: str = "上传完成"):
        """上传成功"""
        self._emit(PublishStage.UPLOAD_SUCCESS, message=message)

    def upload_fail(self, message: str = "上传失败", detail: str = ""):
        """上传失败"""
        self._emit(PublishStage.UPLOAD_FAIL, message=message, detail=detail)

    def pushing(self, message: str = "正在推送数据"):
        """推送中"""
        self._emit(PublishStage.PUSHING, message=message)

    def push_success(self, message: str = "推送成功"):
        """推送成功"""
        self._emit(PublishStage.PUSH_SUCCESS, message=message)

    def push_fail(self, message: str = "推送失败", detail: str = ""):
        """推送失败"""
        self._emit(PublishStage.PUSH_FAIL, message=message, detail=detail)

    def audit_waiting(self, message: str = "等待审核"):
        """等待审核"""
        self._emit(PublishStage.AUDIT_WAITING, message=message)

    def audit_pass(self, message: str = "审核通过"):
        """审核通过"""
        self._emit(PublishStage.AUDIT_PASS, message=message)

    def audit_deny(self, message: str = "审核未通过", detail: str = ""):
        """审核驳回"""
        self._emit(PublishStage.AUDIT_DENY, message=message, detail=detail)

    def completed(self, message: str = "发布完成"):
        """发布完成"""
        self._emit(PublishStage.COMPLETED, message=message)

    def failed(self, message: str = "发布失败", detail: str = ""):
        """发布失败"""
        self._emit(PublishStage.FAILED, message=message, detail=detail)


# ============================================================
# IPC 桥接（Electron 专用）
# ============================================================


def create_ipc_progress_callback(send_ipc: Callable[[str, Any], None]) -> ProgressCallback:
    """
    创建 IPC 进度回调

    用于 Electron 主进程，将进度事件通过 IPC 发送给渲染进程。

    Args:
        send_ipc: IPC 发送函数，例如 (channel, data) => mainWindow.webContents.send(channel, data)

    Usage:
        reporter = ProgressReporter(
            task_id="task-001",
            platform="weibo",
            callbacks=[create_ipc_progress_callback(mainWindow.webContents.send)]
        )
    """

    def callback(event: ProgressEvent):
        send_ipc("publish:progress", event.to_dict())

    return callback
