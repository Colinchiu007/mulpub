"""
Download Manager — 文件下载队列管理器

下载封面图、视频素材到本地临时目录，带缓存和并发控制。

架构参考：参考产品 Yt.downloadFile + downloadingList 去重缓存
"""

import asyncio
import hashlib
import logging
import os
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)


# ============================================================
# 下载结果
# ============================================================


@dataclass
class DownloadResult:
    """下载结果"""

    source_url: str  # 原始 URL
    local_path: str = ""  # 本地文件路径
    state: int = 0  # 0=下载中, 1=已完成, -1=失败
    msg: str = ""  # 错误信息
    file_size: int = 0  # 文件大小（字节）
    file_type: str = "mp4"  # 文件类型
    duration: float = 0.0  # 下载耗时


# ============================================================
# 下载管理器
# ============================================================


class DownloadManager:
    """
    文件下载管理器

    功能：
    1. 去重：相同 URL 同时只下载一次，后续请求等待已有下载完成
    2. 缓存：已下载的文件直接返回本地路径
    3. 并发：限制同时下载的连接数
    4. 自动目录管理：按类型分类存储

    用法：
        dm = DownloadManager()
        result = await dm.download("https://example.com/cover.jpg", key="task-001-cover")
    """

    # 下载缓存：key → DownloadResult
    _cache: dict[str, DownloadResult] = {}
    # 等待中的 Future：key → list[Future]
    _waiters: dict[str, list[asyncio.Future]] = {}

    def __init__(
        self,
        download_dir: str | None = None,
        max_concurrent: int = 3,
        max_retries: int = 3,
        timeout: int = 300,
    ):
        """
        Args:
            download_dir: 下载目录（默认系统临时目录下的 multi-publish-downloads）
            max_concurrent: 最大并发下载数
            max_retries: 最大重试次数
            timeout: 单次下载超时（秒）
        """
        self.download_dir = download_dir or os.path.join(tempfile.gettempdir(), "multi-publish-downloads")
        self.max_concurrent = max_concurrent
        self.max_retries = max_retries
        self.timeout = timeout
        self._semaphore = asyncio.Semaphore(max_concurrent)
        self._http: httpx.AsyncClient | None = None
        self._ensure_dir()

    def _ensure_dir(self):
        """确保下载目录存在"""
        os.makedirs(self.download_dir, exist_ok=True)
        # 创建子目录
        for sub in ["covers", "videos", "images", "temp"]:
            os.makedirs(os.path.join(self.download_dir, sub), exist_ok=True)

    @property
    def http(self) -> httpx.AsyncClient:
        if self._http is None:
            self._http = httpx.AsyncClient(
                timeout=self.timeout,
                follow_redirects=True,
                limits=httpx.Limits(max_keepalive_connections=5),
            )
        return self._http

    async def close(self):
        """关闭 HTTP 客户端"""
        if self._http:
            await self._http.aclose()
            self._http = None

    # ========== 下载方法 ==========

    async def download(
        self,
        url: str,
        key: str | None = None,
        file_type: str = "mp4",
        filename: str | None = None,
        progress_callback: Callable[[int, int], None] | None = None,
    ) -> DownloadResult:
        """
        下载文件

        Args:
            url: 文件 URL
            key: 缓存键（用于去重和缓存，默认自动生成）
            file_type: 文件类型（决定存储子目录）
            filename: 自定义文件名（自动生成如果为空）
            progress_callback: 进度回调 (downloaded, total)

        Returns:
            DownloadResult
        """
        if not url:
            return DownloadResult(source_url=url, state=-1, msg="URL 为空")

        if not url.startswith("http"):
            # 本地路径直接返回
            return DownloadResult(
                source_url=url,
                local_path=url,
                state=1,
            )

        # 生成缓存键
        if key is None:
            key = hashlib.md5(url.encode()).hexdigest()

        # === 检查缓存 ===
        cached = self._cache.get(key)
        if cached and cached.state == 1 and os.path.exists(cached.local_path):
            logger.debug(f"缓存命中: {url} → {cached.local_path}")
            return cached

        if cached and cached.state == -1:
            # 之前失败过，清除后重试
            del self._cache[key]

        # === 等待完成（已有一个下载进行中） ===
        if key in self._cache and self._cache[key].state == 0:
            waiter = asyncio.get_event_loop().create_future()
            self._waiters.setdefault(key, []).append(waiter)
            logger.debug(f"等待已有下载完成: {url}")
            try:
                return await asyncio.wait_for(waiter, timeout=self.timeout)
            except TimeoutError:
                return DownloadResult(source_url=url, state=-1, msg="等待下载超时")

        # === 发起下载 ===
        result = DownloadResult(source_url=url, state=0, file_type=file_type)
        self._cache[key] = result

        try:
            result = await self._do_download(url, key, file_type, filename, progress_callback)
            self._cache[key] = result
            return result
        except Exception as e:
            result.state = -1
            result.msg = str(e)
            self._cache[key] = result
            return result
        finally:
            # 通知等待者
            waiters = self._waiters.pop(key, [])
            for waiter in waiters:
                if not waiter.done():
                    waiter.set_result(result)

    async def _do_download(
        self,
        url: str,
        key: str,
        file_type: str,
        filename: str | None,
        progress_callback: Callable[[int, int], None] | None,
    ) -> DownloadResult:
        """执行实际下载"""
        result = DownloadResult(source_url=url, state=0, file_type=file_type)
        start_time = time.time()

        # 确定存储目录和文件名
        sub_dir = self._get_sub_dir(file_type)
        if filename:
            local_name = filename
        else:
            ext = self._guess_ext(url, file_type)
            local_name = f"{key}{ext}"

        local_path = os.path.join(sub_dir, local_name)

        # 如果文件已存在，直接返回
        if os.path.exists(local_path):
            file_size = os.path.getsize(local_path)
            result.local_path = local_path
            result.state = 1
            result.file_size = file_size
            return result

        # 下载（支持重试）
        last_error = ""
        for attempt in range(self.max_retries):
            try:
                async with self._semaphore:
                    async with self.http.stream("GET", url) as response:
                        response.raise_for_status()
                        total = int(response.headers.get("content-length", 0))
                        downloaded = 0

                        # 先下载到临时文件
                        temp_path = local_path + ".downloading"
                        with open(temp_path, "wb") as f:
                            async for chunk in response.aiter_bytes(chunk_size=65536):
                                f.write(chunk)
                                downloaded += len(chunk)
                                if progress_callback and total > 0:
                                    progress_callback(downloaded, total)

                        # 下载完成，重命名
                        os.replace(temp_path, local_path)

                        result.local_path = local_path
                        result.state = 1
                        result.file_size = downloaded
                        result.duration = time.time() - start_time
                        logger.info(f"下载完成: {url} → {local_path} ({downloaded / 1024:.1f}KB)")
                        return result

            except (httpx.TimeoutException, httpx.HTTPError, OSError) as e:
                last_error = str(e)
                logger.warning(f"下载失败 (attempt {attempt + 1}/{self.max_retries}): {url}, error={e}")
                if attempt < self.max_retries - 1:
                    # 指数退避
                    await asyncio.sleep(2**attempt)
                # 清理临时文件
                temp_path = local_path + ".downloading"
                if os.path.exists(temp_path):
                    try:
                        os.remove(temp_path)
                    except OSError:
                        pass

        result.state = -1
        result.msg = f"下载失败（已重试 {self.max_retries} 次）: {last_error}"
        return result

    # ========== 缓存管理 ==========

    def clear_cache(self):
        """清除内存缓存（不删除文件）"""
        self._cache.clear()
        self._waiters.clear()

    def get_cache_size(self) -> int:
        """缓存中的条目数"""
        return len(self._cache)

    def is_downloading(self, key: str) -> bool:
        """检查是否正在下载"""
        cached = self._cache.get(key)
        return cached is not None and cached.state == 0

    # ========== 辅助方法 ==========

    def _get_sub_dir(self, file_type: str) -> str:
        """根据文件类型获取存储目录"""
        type_map = {
            "jpg": "images",
            "jpeg": "images",
            "png": "images",
            "gif": "images",
            "webp": "images",
            "mp4": "videos",
            "mov": "videos",
            "avi": "videos",
            "cover": "covers",
        }
        sub = type_map.get(file_type.lower(), "temp")
        path = os.path.join(self.download_dir, sub)
        os.makedirs(path, exist_ok=True)
        return path

    def _guess_ext(self, url: str, file_type: str) -> str:
        """从 URL 猜测文件扩展名"""
        # 从 URL 路径取
        path = url.split("?")[0]
        ext = os.path.splitext(path)[1]
        if ext and len(ext) <= 5:
            return ext

        # 从 Content-Type 推断
        ext_map = {
            "image/jpeg": ".jpg",
            "image/png": ".png",
            "image/gif": ".gif",
            "image/webp": ".webp",
            "video/mp4": ".mp4",
            "video/quicktime": ".mov",
        }
        return ext_map.get(file_type, f".{file_type.split('/')[-1] or 'bin'}")

    # ========== 静态工具 ==========

    @staticmethod
    def format_size(size_bytes: int) -> str:
        """格式化文件大小"""
        if size_bytes < 1024:
            return f"{size_bytes}B"
        elif size_bytes < 1024 * 1024:
            return f"{size_bytes / 1024:.1f}KB"
        else:
            return f"{size_bytes / 1024 / 1024:.1f}MB"
