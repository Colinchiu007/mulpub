"""
基础发布器接口

所有平台发布器必须继承此类并实现抽象方法。
"""

import asyncio
from abc import ABC, abstractmethod
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from typing import Any

from multi_publish.models import PlatformType, PublishPhase, PublishResult
from multi_publish.publishers.account_paths import build_account_storage_paths

# ═══════════════════════════════════════════════════════════════
# P1: 进度节流阀（参考产品 UploadEmitGate）
# ═══════════════════════════════════════════════════════════════


class ProgressThrottle:
    """
    进度事件节流阀（参考产品 UploadEmitGate 风格）

    大文件上传时，按 5 秒间隔限频；
    小文件/多分片时，按 10% 幅度报一次。

    用法:
        throttle = ProgressThrottle()
        if throttle.should_report(percent):
            await callback(...)
    """

    def __init__(self, min_interval: float = 5.0, min_percent_delta: int = 10):
        """
        Args:
            min_interval: 最小上报间隔（秒），适用于大文件
            min_percent_delta: 最小百分比变化幅度，适用于小文件
        """
        self._last_time = 0.0
        self._last_percent = 0
        self._min_interval = min_interval
        self._min_percent_delta = min_percent_delta

    def should_report(self, percent: int) -> bool:
        """判断当前进度是否需要上报"""
        if percent == 100:
            return True  # 完成必须上报
        if percent - self._last_percent < self._min_percent_delta:
            import time

            if time.time() - self._last_time < self._min_interval:
                return False
        import time

        self._last_time = time.time()
        self._last_percent = percent
        return True

    def reset(self):
        """重置节流状态（用于新的一次发布）"""
        self._last_time = 0.0
        self._last_percent = 0


# ═══════════════════════════════════════════════════════════════
# P0: CDP/Playwright 网络响应拦截（替代 DOM 轮询）
# ═══════════════════════════════════════════════════════════════


class ResponseMonitor:
    """
    Playwright 页面 API 响应监控器

    替代 wait_for_selector() DOM 轮询，通过监听页面 XHR/Fetch 响应
    来判断操作结果。平台 UI 改版不影响，比 DOM 检测更稳定。

    参考产品使用 Chrome DevTools Protocol Fetch 域拦截网络响应，
    这里用 Playwright 原生 page.on("response") 事件实现，效果相同。

    用法:
        monitor = ResponseMonitor(page)
        monitor.watch_patterns(["aweme/create", "aweme/post"])
        page.goto(...)
        # ... 执行发布操作 ...
        result = await monitor.wait_for_response(timeout=60)
        if result and result.get("code") == 0:
            logger.success("发布成功（API 确认）")
    """

    def __init__(self, page):
        self._page = page
        self._responses: list[dict] = []
        self._done = asyncio.Event()
        self._patterns: list[str] = []

    async def _on_response(self, response):
        """Playwright response event handler（异步版本）"""
        from loguru import logger

        url = response.url
        if not any(p in url for p in self._patterns):
            return
        logger.debug(f"[ResponseMonitor] 捕获 API 响应: {url}")
        try:
            # Playwright 的 response.text() 可多次调用，不影响页面
            text = await response.text()
            import json

            try:
                data = json.loads(text)
                self._responses.append({"url": url, "data": data})
                self._done.set()
            except json.JSONDecodeError:
                pass
        except Exception:
            pass

    def watch_patterns(self, patterns: list[str]):
        """
        注册需要监控的 URL 模式（子串匹配）

        Args:
            patterns: URL 子串列表，如 ["aweme/create", "aweme/post"]
        """
        self._patterns = patterns
        self._page.on("response", self._on_response)

    def stop(self):
        """停止监控"""
        self._page.remove_listener("response", self._on_response)

    async def wait_for_response(
        self, timeout: float = 30.0, predicate: Callable[[dict], bool] | None = None
    ) -> dict | None:
        """
        等待 API 响应

        Args:
            timeout: 超时（秒）
            predicate: 过滤函数，接收 response data 返回 bool

        Returns:
            匹配的响应 JSON 数据，超时返回 None
        """
        try:
            await asyncio.wait_for(self._done.wait(), timeout=timeout)
        except TimeoutError:
            return None

        for r in self._responses:
            data = r["data"]
            if predicate is None or predicate(data):
                return data
        return self._responses[-1] if self._responses else None

    @property
    def all_responses(self) -> list[dict]:
        return list(self._responses)


# ═══════════════════════════════════════════════════════════════
# 重试工具（参考产品风格）
# ═══════════════════════════════════════════════════════════════


async def async_retry(fn: Callable[[], Coroutine], max_retries: int = 5, interval: float = 1.0) -> Any:
    """
    异步重试工具

    Args:
        fn: 异步函数（无参数，需用 partial 或 lambda 包装）
        max_retries: 最大重试次数
        interval: 重试间隔（秒）

    Returns:
        fn 的返回值

    Raises:
        最后一次尝试的异常（所有重试都失败时）
    """
    import asyncio

    last_exc = None
    for attempt in range(max_retries):
        try:
            return await fn()
        except Exception as e:
            last_exc = e
            if attempt < max_retries - 1:
                await asyncio.sleep(interval)
    raise last_exc  # type: ignore


async def wait_until(
    predicate,
    timeout_s: float,
    interval_s: float = 0.5,
) -> bool:
    """条件轮询工具（替代固定 ``asyncio.sleep``）。

    Args:
        predicate: 无参可调用，返回真值即视为条件成立；同步/异步均可；
            抛异常按「本轮条件不成立」处理（页面导航中等瞬时错误不该终止等待）。
        timeout_s: 等待上限（秒），到点仍不成立返回 False。
        interval_s: 轮询间隔（秒），最后一次轮询会被裁剪到上限时刻，不越过 deadline。

    Returns:
        True 表示条件在时限内成立；False 表示超时。

    调用方必须显式处理 False 分支并记录「超时原因」：多数 RPA 场景里「等不到」
    只代表页面结构不匹配，不等于操作失败，直接判失败会把可用路径改坏。
    """
    import asyncio
    import inspect
    import time

    deadline = time.monotonic() + max(0.0, float(timeout_s))
    step = max(0.05, float(interval_s))
    while True:
        try:
            value = predicate()
            if inspect.isawaitable(value):
                value = await value
            if value:
                return True
        except Exception:
            value = False
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        await asyncio.sleep(min(step, remaining))


# ─── Per-Field 重试状态机（参考产品 renderTaskMap 风格）───────────


class FieldRetryMap:
    """
    每字段独立重试状态机（参考产品 renderTaskMap 风格）

    每个操作字段独立维护 retry 计数器：
    - video 上传失败 -> 不影响 title 填写
    - title 填不上 -> cover 继续尝试
    - 所有字段各自跑满 retryCount 后才放弃

    用法:
        fields = FieldRetryMap(retry_count=5)
        fields.add_field("video")
        while fields.has_unfinished:
            for field in fields.unfinished_fields:
                try:
                    do_field(field)
                    fields.mark_done(field)
                except Exception:
                    if not fields.retry(field):
                        logger.warning(f"{field} 已耗尽重试次数")
                    await asyncio.sleep(1)
    """

    def __init__(self, retry_count: int = 5):
        self._retry_count = retry_count
        self._map: dict[str, int] = {}

    def add_field(self, name: str, initial: int = 0):
        """添加字段"""
        self._map[name] = initial

    def mark_done(self, name: str):
        """标记字段完成（设为 retryCount 表示完成/跳过）"""
        self._map[name] = self._retry_count

    def retry(self, name: str) -> bool:
        """
        尝试重试一个字段

        Returns:
            True 如果还可以继续重试，False 已耗尽
        """
        if name not in self._map:
            return False
        self._map[name] += 1
        return self._map[name] < self._retry_count

    def is_done(self, name: str) -> bool:
        """字段是否已完成（成功或已耗尽）"""
        return self._map.get(name, self._retry_count) >= self._retry_count

    @property
    def unfinished_fields(self) -> list[str]:
        """获取未完成的字段列表"""
        return [n for n, c in self._map.items() if c < self._retry_count]

    @property
    def has_unfinished(self) -> bool:
        """是否有未完成的字段"""
        return any(c < self._retry_count for c in self._map.values())

    @property
    def all_done(self) -> bool:
        """所有字段是否已完成"""
        return not self.has_unfinished

    @property
    def exhausted_fields(self) -> list[str]:
        """获取已耗尽重试次数的字段"""
        return [n for n, c in self._map.items() if c == self._retry_count - 1]

    def snapshot(self) -> dict[str, int]:
        """当前状态快照"""
        return dict(self._map)


# ─── XPath 式 DOM 查找工具（参考产品风格）───────────────────────
# 使用 XPath 而不是 CSS 选择器查找元素，更稳定

DOM_XPATH_UTILITIES = """
// 参考产品风格的 XPath 元素查找工具
// 注入到页面中使用：page.evaluate(getElementByText, ['button', '发布'])

function getElementByText(tag, text, container) {
    container = container || document;
    var xpathResult = document.evaluate(
        '//' + tag + "[text()='" + text + "']",
        container, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    );
    return xpathResult.snapshotItem(0);
}

function getElementContainingText(tag, text, container) {
    container = container || document;
    var xpathResult = document.evaluate(
        '//' + tag + "[contains(text(), '" + text + "')]",
        container, null,
        XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    );
    return xpathResult.snapshotItem(0);
}
"""

# ─── 文件上传工具（参考产品风格 DataTransfer + dispatchEvent）────
# 比 Playwright set_input_files() 更接近真实用户操作

DOM_FILE_UPLOAD_UTILITIES = """
// 参考产品风格的 DataTransfer 文件上传
function createFileFromBuffer(uint8Array, fileName, mimeType) {
    var blob = new Blob([uint8Array], { type: mimeType });
    return new File([blob], fileName, { type: mimeType });
}

function dispatchFileToInput(inputElement, file) {
    var dt = new DataTransfer();
    dt.items.add(file);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'files').set.call(inputElement, dt.files);
    inputElement.dispatchEvent(new Event('change', { bubbles: true }));
}
"""


@dataclass
class PublisherConfig:
    """发布器配置基类"""

    platform: PlatformType
    data_dir: str = "./data"  # 数据存储目录（Cookie、配置等）
    headless: bool = False  # 是否无头模式
    proxy: dict | None = None  # P2-1: SOCKS5 代理配置（Playwright 格式）


class BasePublisher(ABC):
    """
    基础发布器

    所有平台发布器必须实现：
    - initialize(): 初始化资源
    - publish(): 发布内容
    - check_auth(): 检查认证状态
    - close(): 关闭资源

    RPA 发布器额外需要：
    - login(): 启动登录流程
    - _save_auth_data(): 保存认证数据（cookies + localStorage + IndexedDB）
    - _restore_auth_data(): 恢复完整认证数据
    """

    def __init__(self, config: PublisherConfig, account_id: str | None = None):
        self.config = config
        self._cookies: list[dict] = []
        self.account_id: str | None = account_id
        self._cookie_path: str = ""
        self._progress_callback: Callable[[PublishPhase, str, int], Coroutine] | None = None

    def _configure_account_storage(self) -> None:
        """为当前平台与账号配置隔离的认证和浏览器目录。"""
        paths = build_account_storage_paths(self.config.data_dir, self.platform.value, self.account_id)
        self._account_data_dir = str(paths.account_dir)
        self._auth_data_path = str(paths.auth_file)
        self._cookie_path = str(paths.cookie_file)
        self._legacy_auth_data_path = str(paths.legacy_auth_file)
        self._legacy_cookie_path = str(paths.legacy_cookie_file)
        self._browser_data_dir = str(paths.browser_dir)
        self._browser_check_data_dir = str(paths.browser_check_dir)

    def _get_browser_data_dir(self, check: bool = False) -> str:
        """返回当前账号的持久化浏览器目录。"""
        return self._browser_check_data_dir if check else self._browser_data_dir

    @property
    def proxy_config(self) -> dict | None:
        """获取代理配置（Playwright 格式），P2-1: SOCKS5 per-tab"""
        return self.config.proxy

    def set_progress_callback(self, callback: Callable[[PublishPhase, str, int], Coroutine] | None):
        """设置进度回调（由 PublisherManager 调用）"""
        self._progress_callback = callback

    async def _report_progress(self, phase: PublishPhase, message: str, percent: int):
        """
        报告发布进度

        Args:
            phase: 当前阶段
            message: 进度消息
            percent: 进度百分比（0-100）
        """
        if self._progress_callback:
            try:
                await self._progress_callback(phase, message, percent)
            except Exception:
                pass
        from loguru import logger

        logger.info(f"[{self.platform.value}] {phase.value}: {message} ({percent}%)")

    @property
    @abstractmethod
    def platform(self) -> PlatformType:
        """返回发布器对应的平台类型"""
        pass

    @abstractmethod
    async def initialize(self):
        """
        初始化资源

        子类可重写此方法初始化特定资源（如 Playwright 浏览器、HTTP 客户端等）
        """
        pass

    @abstractmethod
    async def publish(self, title: str, content: str, **kwargs) -> PublishResult:
        """
        发布内容到平台

        Args:
            title: 文章标题
            content: 文章内容（Markdown / 纯文本）
            **kwargs: 平台特定参数
                - media_paths: 媒体文件路径列表（视频/图片）
                - cover_path: 封面图路径
                - tags: 标签列表
                - category: 分类
                - draft: 是否发布为草稿

        Returns:
            PublishResult: 发布结果
        """
        pass

    @abstractmethod
    async def check_auth(self) -> bool:
        """
        检查认证状态

        Returns:
            True 如果认证有效，False 如果需要重新登录
        """
        pass

    async def login(self) -> bool:
        """
        启动登录流程（RPA 发布器）

        打开浏览器，等待用户手动登录（扫码/账号密码），
        登录成功后自动捕获 Cookie 并加密存储。

        Returns:
            True 如果登录成功
        """
        raise NotImplementedError("此发布器不支持手动登录")
