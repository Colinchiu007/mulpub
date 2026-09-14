"""
数据同步系统 — 跨平台数据拉取

定时拉取各平台的：
1. 账号概览数据（粉丝数、阅读量等）
2. 已发布内容列表

每个平台分别实现 API 调用，统一回调到服务端或前端。

架构参考：参考产品 pushDataSyncTask + DataService.SyncDataService
"""

import asyncio
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from multi_publish.core.query_worker import (
    AccountOverview,
    ContentItem,
    QueryWorkerFactory,
)

logger = logging.getLogger(__name__)


# ============================================================
# 同步类型
# ============================================================


class SyncType:
    """同步类型枚举"""

    ACCOUNT_OVERVIEW = "accountOverView"  # 账号概览
    CONTENT_LIST = "contentList"  # 内容列表


# ============================================================
# 数据模型
# ============================================================


@dataclass
class SyncTask:
    """
    数据同步任务

    Attributes:
        platform: 平台名称
        account_id: 账号 ID
        account_name: 账号名称
        cookie: 登录凭证
        sync_type: 同步类型
        callback: 回调函数
        execute_at: 执行时间
        retry_count: 已重试次数
        max_retries: 最大重试次数
        status: 任务状态
    """

    platform: str
    account_id: str
    account_name: str
    cookie: str
    sync_type: str
    callback: Callable[[str, AccountOverview | list[ContentItem], int], Any] | None = None
    execute_at: datetime = field(default_factory=datetime.now)
    retry_count: int = 0
    max_retries: int = 3
    status: str = "pending"


@dataclass
class SyncResult:
    """同步结果"""

    platform: str = ""
    account_id: str = ""
    sync_type: str = ""
    success: bool = False
    data: Any = None
    error: str = ""
    timestamp: str = ""


# ============================================================
# 数据同步器
# ============================================================


class DataSyncService:
    """
    跨平台数据同步器

    功能：
    1. 定时拉取各平台的账号概览（粉丝、阅读）
    2. 定时拉取各平台的内容列表
    3. 结果通过回调上报给前端或服务端
    4. 去重：同账号同类型多个任务合并

    用法：
        dss = DataSyncService()
        dss.start()

        # 添加同步任务
        dss.push("weibo", "acc-001", "微博账号A", cookie, SyncType.ACCOUNT_OVERVIEW, callback)
    """

    def __init__(self, check_interval: int = 5, max_concurrent: int = 3):
        """
        Args:
            check_interval: 调度检查间隔（秒）
            max_concurrent: 最大并发同步数
        """
        self.check_interval = check_interval
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._tasks: list[SyncTask] = []
        self._dedup: dict[str, SyncTask] = {}  # "{platform}:{sync_type}:{account_id}" → task
        self._running = False
        self._worker_task: asyncio.Task | None = None

    # ========== 生命周期 ==========

    async def start(self):
        """启动同步器"""
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("数据同步器已启动")

    async def stop(self):
        """停止同步器"""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        logger.info("数据同步器已停止")

    # ========== 任务管理 ==========

    def push(
        self,
        platform: str,
        account_id: str,
        account_name: str,
        cookie: str,
        sync_type: str,
        callback: Callable[[str, AccountOverview | list[ContentItem], int], Any] | None = None,
        delay_seconds: int = 0,
    ) -> str:
        """
        推送数据同步任务

        Args:
            platform: 平台名称
            account_id: 账号 ID
            account_name: 账号名称
            cookie: 登录凭证
            sync_type: SyncType.ACCOUNT_OVERVIEW 或 SyncType.CONTENT_LIST
            callback: 回调 (platform, data, code)
            delay_seconds: 延迟执行秒数（默认立即）

        Returns:
            task_key: "{platform}:{sync_type}:{account_id}"
        """
        task = SyncTask(
            platform=platform,
            account_id=account_id,
            account_name=account_name,
            cookie=cookie,
            sync_type=sync_type,
            callback=callback,
            execute_at=datetime.now() + timedelta(seconds=delay_seconds),
        )

        task_key = f"{platform}:{sync_type}:{account_id}"

        # 去重：同 key 的 pending 任务替换
        existing = self._dedup.get(task_key)
        if existing and existing.status == "pending":
            # 替换为新的（更新执行时间）
            existing.cookie = cookie
            existing.execute_at = task.execute_at
            existing.retry_count = 0
            logger.debug(f"替换同步任务: {task_key}")
            return task_key

        # 新任务
        self._tasks.append(task)
        self._dedup[task_key] = task
        logger.debug(f"添加同步任务: {task_key}")
        return task_key

    def remove(self, task_key: str) -> bool:
        """移除同步任务"""
        task = self._dedup.pop(task_key, None)
        if task:
            task.status = "cancelled"
            if task in self._tasks:
                self._tasks.remove(task)
            return True
        return False

    def count_pending(self) -> int:
        """待执行任务数"""
        return sum(1 for t in self._tasks if t.status == "pending")

    # ========== 调度执行 ==========

    async def _worker_loop(self):
        """调度主循环"""
        while self._running:
            now = datetime.now()

            ready = []
            for task in self._tasks:
                if task.status == "pending" and now >= task.execute_at:
                    ready.append(task)

            if ready:
                await asyncio.gather(
                    *[self._execute_sync(task) for task in ready],
                    return_exceptions=True,
                )

            # 清理已完成的任务
            self._tasks = [t for t in self._tasks if t.status == "pending"]
            self._dedup = {k: v for k, v in self._dedup.items() if v.status == "pending"}

            await asyncio.sleep(self.check_interval)

    async def _execute_sync(self, task: SyncTask):
        """执行单个同步任务"""
        async with self._semaphore:
            task.status = "running"

            try:
                # 获取对应的 QueryWorker
                worker = QueryWorkerFactory.create(
                    task.platform,
                    task.cookie,
                )

                if task.sync_type == SyncType.ACCOUNT_OVERVIEW:
                    # 拉取账号概览
                    overview = await worker.get_overview_data()
                    overview.platform = task.platform

                    if task.callback:
                        try:
                            task.callback(task.account_id, overview, 0)
                        except Exception as cb_err:
                            logger.error(f"概览回调错误: {cb_err}")

                    logger.info(f"同步概览完成: {task.platform}/{task.account_name}")
                    task.status = "completed"

                elif task.sync_type == SyncType.CONTENT_LIST:
                    # 拉取内容列表
                    result = await worker.search_content_list(page=1, days=7)
                    content_list = result.get("data", [])
                    code = result.get("code", 0)

                    if task.callback:
                        try:
                            task.callback(task.account_id, content_list, code)
                        except Exception as cb_err:
                            logger.error(f"内容列表回调错误: {cb_err}")

                    logger.info(f"同步内容列表完成: {task.platform}/{task.account_name}, 共 {len(content_list)} 条")
                    task.status = "completed"

                else:
                    logger.warning(f"未知同步类型: {task.sync_type}")
                    task.status = "failed"

            except ValueError as e:
                if "不支持的平台" in str(e):
                    logger.warning(f"不支持的平台: {task.platform}")
                    task.status = "completed"  # 标记完成，不再重试
                else:
                    task.retry_count += 1
                    if task.retry_count < task.max_retries:
                        task.execute_at = datetime.now() + timedelta(seconds=30)
                        task.status = "pending"
                        logger.debug(f"同步将重试 ({task.retry_count}/{task.max_retries}): {task.platform}")
                    else:
                        task.status = "failed"
                        logger.error(f"同步已达最大重试: {task.platform}/{task.account_id}")

            except Exception as e:
                logger.error(f"同步异常: {task.platform}/{task.account_id}, error={e}")
                task.retry_count += 1
                if task.retry_count < task.max_retries:
                    task.execute_at = datetime.now() + timedelta(seconds=30)
                    task.status = "pending"
                else:
                    task.status = "failed"

    # ========== 便捷方法 ==========

    async def sync_overview(
        self,
        platform: str,
        account_id: str,
        account_name: str,
        cookie: str,
        callback: Callable[[str, AccountOverview, int], Any] | None = None,
    ) -> str:
        """便捷方法：同步账号概览"""
        return self.push(
            platform=platform,
            account_id=account_id,
            account_name=account_name,
            cookie=cookie,
            sync_type=SyncType.ACCOUNT_OVERVIEW,
            callback=callback,
        )

    async def sync_content_list(
        self,
        platform: str,
        account_id: str,
        account_name: str,
        cookie: str,
        callback: Callable[[str, list[ContentItem], int], Any] | None = None,
    ) -> str:
        """便捷方法：同步内容列表"""
        return self.push(
            platform=platform,
            account_id=account_id,
            account_name=account_name,
            cookie=cookie,
            sync_type=SyncType.CONTENT_LIST,
            callback=callback,
        )


# ============================================================
# 全局实例（单例模式）
# ============================================================

_default_service: DataSyncService | None = None


def get_data_sync_service() -> DataSyncService:
    """获取全局数据同步服务实例"""
    global _default_service
    if _default_service is None:
        _default_service = DataSyncService()
    return _default_service
