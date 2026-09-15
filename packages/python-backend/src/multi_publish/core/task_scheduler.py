"""
Task Scheduler — 定时状态轮询调度器

发布后每隔 n 秒自动查询审核状态，支持重试和动态延迟。
与 PublishScheduler 分离：PublishScheduler 管"定时发布"，这个管"发布后状态追踪"。

架构参考：参考产品 QueryStateScheduledTask + stateQuerySchedulerService
"""

import asyncio
import logging
from collections.abc import Callable, Coroutine
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

logger = logging.getLogger(__name__)


# ============================================================
# 调度任务
# ============================================================


@dataclass
class StateQueryTask:
    """
    状态查询任务

    Attributes:
        task_id: 任务唯一标识
        key: 去重键（同一个 platform:accountId 的重复任务会被合并）
        callback: 异步回调函数
        execute_at: 计划执行时间
        retry_count: 已重试次数
        max_retries: 最大重试次数
        retry_delay_base: 基础重试延迟（秒），每次重试递增
        last_result: 上次查询结果
        status: 任务状态
    """

    task_id: str
    key: str
    callback: Callable[[], Coroutine[Any, Any, Any]]
    execute_at: datetime = field(default_factory=datetime.now)
    retry_count: int = 0
    max_retries: int = 10
    retry_delay_base: int = 60  # 基础延迟 1 分钟
    last_result: Any = None
    status: str = "pending"  # pending | running | completed | failed


class StateQueryScheduler:
    """
    状态查询调度器

    功能：
    1. 延迟执行：指定时间后执行回调
    2. 自动重试：失败后按递增间隔重试
    3. 去重：同一个 key 的旧任务会被替换
    4. 并发控制：限制同时执行的查询数

    使用场景：
    - 发布内容后，定时查询审核状态
    - 每 X 秒查一次，最多重试 N 次
    """

    def __init__(self, max_concurrent: int = 5):
        self._tasks: dict[str, StateQueryTask] = {}  # task_id → task
        self._keys: dict[str, str] = {}  # key → task_id
        self._running = False
        self._worker_task: asyncio.Task | None = None
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._pending: set[str] = set()  # pending task_ids for dedup

    # ========== 任务管理 ==========

    def push(
        self,
        task: StateQueryTask,
    ) -> str:
        """
        添加状态查询任务

        如果 key 相同且已有任务在排队，替换旧任务。
        如果 key 相同且已有任务在执行，忽略（不重复查询）。

        Args:
            task: 状态查询任务

        Returns:
            task_id
        """
        # 去重：替换同 key 的未执行任务
        existing_task_id = self._keys.get(task.key)
        if existing_task_id and existing_task_id in self._tasks:
            existing = self._tasks[existing_task_id]
            if existing.status == "pending":
                # 替换为新的（推迟执行时间）
                existing.execute_at = task.execute_at
                existing.callback = task.callback
                existing.retry_count = 0
                existing.max_retries = task.max_retries
                logger.debug(f"替换同 key 任务: {task.key}, 新执行时间: {task.execute_at}")
                return existing_task_id

        # 添加新任务
        self._tasks[task.task_id] = task
        self._keys[task.key] = task.task_id
        self._pending.add(task.task_id)
        logger.debug(f"添加状态查询任务: {task.task_id}, key={task.key}, 执行时间={task.execute_at}")
        return task.task_id

    def remove(self, task_id: str) -> bool:
        """移除任务"""
        task = self._tasks.pop(task_id, None)
        if task:
            self._keys.pop(task.key, None)
            self._pending.discard(task_id)
            return True
        return False

    def get_task(self, task_id: str) -> StateQueryTask | None:
        """获取任务"""
        return self._tasks.get(task_id)

    def list_tasks(self) -> list[StateQueryTask]:
        """列出所有任务"""
        return list(self._tasks.values())

    def count_pending(self) -> int:
        """排队中的任务数"""
        return len(self._pending)

    # ========== 调度执行 ==========

    async def start(self):
        """启动调度器"""
        if self._running:
            return
        self._running = True
        self._worker_task = asyncio.create_task(self._worker_loop())
        logger.info("状态查询调度器已启动")

    async def stop(self):
        """停止调度器"""
        self._running = False
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None
        logger.info("状态查询调度器已停止")

    async def _worker_loop(self):
        """调度器主循环 — 每 1 秒检查一次"""
        while self._running:
            now = datetime.now()

            # 找出所有到期的待执行任务
            ready = []
            for task_id, task in list(self._tasks.items()):
                if task.status == "pending" and now >= task.execute_at:
                    ready.append((task_id, task))

            # 并发执行到期任务（受信号量限制）
            if ready:
                tasks = []
                for task_id, task in ready:
                    task.status = "running"
                    self._pending.discard(task_id)
                    tasks.append(self._execute_task(task_id, task))

                await asyncio.gather(*tasks, return_exceptions=True)

            await asyncio.sleep(1)

    async def _execute_task(self, task_id: str, task: StateQueryTask):
        """
        执行单个状态查询任务

        成功 → 标记完成
        失败 → 如果还有重试次数，延迟后重新加入队列
        """
        async with self._semaphore:
            try:
                result = await task.callback()
                task.last_result = result
                task.status = "completed"
                logger.info(f"状态查询成功: {task_id}, key={task.key}")
                return
            except Exception as e:
                logger.warning(f"状态查询失败: {task_id}, key={task.key}, error={e}")
                task.retry_count += 1

                if task.retry_count < task.max_retries:
                    # 动态延迟：首次 1 分钟，后续每次 +1 分钟，最大 10 分钟
                    delay = min(
                        task.retry_delay_base * task.retry_count,
                        600,  # 最大 10 分钟
                    )
                    task.execute_at = datetime.now() + timedelta(seconds=delay)
                    task.status = "pending"
                    self._pending.add(task_id)
                    logger.info(f"状态查询将在 {delay}s 后重试 ({task.retry_count}/{task.max_retries}): {task_id}")
                else:
                    task.status = "failed"
                    logger.error(f"状态查询已达最大重试次数: {task_id}, key={task.key}")

    # ========== 便捷方法 ==========

    def push_audit_check(
        self,
        task_id: str,
        platform: str,
        account_id: str,
        publish_id: str,
        callback: Callable[[], Coroutine[Any, Any, Any]],
        delay_seconds: int = 120,
        max_retries: int = 10,
    ) -> str:
        """
        便捷方法：添加审核状态查询

        Args:
            task_id: 任务 ID（通常与发布任务 ID 相同）
            platform: 平台名称
            account_id: 账号 ID
            publish_id: 发布 ID
            callback: 查询审核状态的异步回调
            delay_seconds: 首次查询延迟（默认 2 分钟后首次查询）
            max_retries: 最大重试次数

        Returns:
            task_id
        """
        task = StateQueryTask(
            task_id=task_id,
            key=f"{platform}:{account_id}:{publish_id}",
            callback=callback,
            execute_at=datetime.now() + timedelta(seconds=delay_seconds),
            max_retries=max_retries,
            retry_delay_base=60,  # 首次重试 1 分钟
        )
        return self.push(task)
