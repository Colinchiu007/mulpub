"""
抖音发布器（API + RPA 双模式）

基于参考产品反编译分析的关键优化：
1. 登录捕获补全 localStorage + IndexedDB（仅 cookies 不够）
2. API 模式优先（直接调用抖音内部 API，更快更稳）
3. RPA 模式作为降级（Playwright 自动化浏览器）
4. 详细进度报告

架构：
  publish()
    ├─ try: _api_publish()       ← 优先 API 模式
    └─ catch: _do_publish()      ← RPA 降级

认证体系（来自参考产品反编译分析）：
  - Cookies: sid_tt, sessionid, bd_ticket_guard_client_data 等
  - localStorage: security-sdk/s_sdk_crypt_sdk, s_sdk_sign_data_key/web_protect
  - IndexedDB (secure-store): s_sdk_cert_key, s_sdk_sign_data_key/web_protect, s_sdk_crypt_sdk
"""

from __future__ import annotations

import asyncio
import json
import os
import time

from loguru import logger

from multi_publish.models import PlatformType, PublishPhase, PublishResult
from multi_publish.publishers.base import (
    BasePublisher,
    FieldRetryMap,
    ProgressThrottle,
    PublisherConfig,
    ResponseMonitor,
)
from multi_publish.publishers.douyin_auth import (
    _capture_indexed_db as _module_capture_indexed_db,
)
from multi_publish.publishers.douyin_auth import (
    _capture_local_storage as _module_capture_local_storage,
)
from multi_publish.publishers.douyin_auth import (
    check_auth as _module_check_auth,
)
from multi_publish.publishers.douyin_auth import (
    load_auth_data as _module_load_auth_data,
)
from multi_publish.publishers.douyin_auth import (
    load_cookies as _module_load_cookies,
)
from multi_publish.publishers.douyin_auth import (
    login as _module_login,
)
from multi_publish.publishers.douyin_auth import (
    restore_auth_data as _module_restore_auth_data,
)
from multi_publish.publishers.douyin_auth import (
    save_auth_data as _module_save_auth_data,
)
from multi_publish.publishers.douyin_auth import (
    save_cookies as _module_save_cookies,
)
from multi_publish.publishers.douyin_rpa_fields import (
    rpa_do_field_cover,
    rpa_do_field_desc,
    rpa_do_field_tags,
    rpa_do_field_title,
    rpa_do_publish_click,
    rpa_do_video_upload,
)

# ─── 默认选择器 ─────────────────────────────────────────────
# 抖音创作服务平台可能改版，选择器变更时只需更新此字典或从 YAML 加载

DEFAULT_SELECTORS = {
    "login_qrcode": '[class*="qrcode"]',
    "login_success_indicator": '[class*="dashboard"]',
    "login_avatar": '[class*="avatar"]',
    "upload_page_url": "https://creator.douyin.com/creator-micro/content/upload",
    "upload_input": 'input[type="file"]',
    "upload_progress": '[class*="progress"]',
    "upload_complete": '[class*="upload-success"]',
    "title_input": '[class*="input"]',
    "cover_upload": '[class*="cover"]',
    "cover_input": 'input[type="file"]',
    "tag_input": '[class*="tag"]',
    "tag_item": '[class*="tag-item"]',
    "description_textarea": '[class*="description"]',
    "publish_button": 'button:has-text("发布")',
    "publish_button_alt": 'button:has-text("保存")',
    "draft_button": 'button:has-text("草稿")',
}

# ─── 抖音 API 端点（从参考产品反编译提取）────────────────────
# 注意：这些端点可能需要随抖音平台更新而调整

DOUYIN_API = {
    "upload_auth": "https://creator.douyin.com/web/api/media/upload/auth/v5/",
    "create_post": "https://creator.douyin.com/web/api/media/aweme/create/",
    "post_video": "https://creator.douyin.com/web/api/media/aweme/post/",
    "user_info": "https://creator.douyin.com/web/api/media/user/info",
}


def _build_launch_kwargs(*, user_data_dir: str, headless: bool, viewport: dict, proxy: dict | None = None) -> dict:
    """构造 ``launch_persistent_context`` 的 kwargs。

    修复原代码中 ``os.path.join(..., proxy=...)`` 关键字参数 bug：
    os.path.join 不接受关键字参数，运行时会抛 TypeError。这里把 proxy
    作为 ``launch_persistent_context`` 的独立 kwarg。
    """
    kwargs: dict = {
        "user_data_dir": user_data_dir,
        "headless": headless,
        "viewport": viewport,
    }
    if proxy:
        kwargs["proxy"] = proxy
    return kwargs


def _upload_auth_log_message(code: object, upload_token: object) -> str:
    """上传授权成功日志：仅输出非敏感元信息，禁止 token/签名 URL 明文。"""
    has_data = isinstance(upload_token, dict) and bool(upload_token)
    has_upload_url = bool(isinstance(upload_token, dict) and upload_token.get("upload_url"))
    return f"上传授权成功 code={code} has_data={has_data} has_upload_url={has_upload_url}"


class DouyinPublisher(BasePublisher):
    """
    抖音视频发布器 — API + RPA 双模式

    发布策略（自动降级）：
    1. 尝试 API 模式（httpx 直接调用抖音 HTTP API）
    2. API 失败 → 自动降级到 RPA 模式（Playwright 浏览器自动化）
    3. RPA 也失败 → 返回失败结果

    认证数据格式（auth_{platform}.json）：
    ```json
    {
        "cookies": [...],
        "local_storage": {"key": "value", ...},
        "indexed_db": {"store_name": {"key": "value"}, ...},
        "captured_at": 1234567890.0
    }
    ```
    """

    def __init__(self, config: PublisherConfig, account_id: str | None = None):
        super().__init__(config, account_id=account_id)
        self._configure_account_storage()
        self._browser = None
        self._context = None
        self._page = None
        self._playwright = None
        self._selectors = dict(DEFAULT_SELECTORS)
        self._login_timeout = 120
        self._publish_timeout = 300
        self._upload_wait_timeout = 600

    @property
    def platform(self) -> PlatformType:
        return PlatformType.DOUYIN

    async def initialize(self):
        """初始化 Playwright 浏览器"""
        try:
            from playwright.async_api import async_playwright
        except ImportError:
            raise ImportError("需要安装 Playwright: pip install playwright && playwright install chromium") from None

        self._playwright_app = await async_playwright().start()
        logger.info("抖音发布器初始化完成")

    # ═══════════════════════════════════════════════════════════
    # 登录 — 委托到 douyin_auth 模块
    # ═══════════════════════════════════════════════════════════

    async def login(self) -> bool:
        """
        打开抖音创作服务平台登录页，等待用户扫码登录后捕获完整认证数据。

        实现委托到 ``douyin_auth.login``，该模块修复了原代码中
        ``os.path.join(..., proxy=...)`` 关键字参数 bug。

        Returns:
            True 登录成功
        """
        return await _module_login(self)

    # ═══════════════════════════════════════════════════════════
    # 认证数据捕获（参考产品方案：三层捕获）— 委托到 douyin_auth
    # ═══════════════════════════════════════════════════════════

    async def _capture_local_storage(self) -> dict[str, str]:
        """
        从浏览器捕获 localStorage 中的所有数据

        关键捕获项（抖音 security-sdk）：
        - security-sdk/s_sdk_crypt_sdk
        - security-sdk/s_sdk_sign_data_key/web_protect
        """
        return await _module_capture_local_storage(self)

    async def _capture_indexed_db(self) -> dict[str, dict]:
        """
        从浏览器捕获 IndexedDB 中的数据

        参考产品反编译发现抖音在 IndexedDB secure-store 中存储了 SDK 证书：
        - security-sdk/s_sdk_cert_key
        - security-sdk/s_sdk_sign_data_key/web_protect
        - security-sdk/s_sdk_crypt_sdk

        Returns:
            {db_name: {store_name: {key: value, ...}}, ...}
            注意：当前专注于 secure-store 数据库
        """
        return await _module_capture_indexed_db(self)

    # ═══════════════════════════════════════════════════════════
    # 认证数据持久化 — 委托到 douyin_auth
    # ═══════════════════════════════════════════════════════════

    def _save_cookies(self, cookies: list[dict]):
        """保存 Cookie 到文件（兼容旧格式）"""
        _module_save_cookies(self, cookies)

    def _save_auth_data(self, cookies: list[dict], local_storage: dict, indexed_db: dict):
        """
        保存完整认证数据（cookies + localStorage + IndexedDB）

        参考产品关键发现：抖音的 security-sdk 认证需要全部三层数据，
        仅保存 cookies 会导致发布时登录态频繁失效。
        """
        _module_save_auth_data(self, cookies, local_storage, indexed_db)

    def _load_cookies(self) -> list[dict]:
        """从文件加载 Cookie（兼容旧格式）"""
        return _module_load_cookies(self)

    def _load_auth_data(self) -> dict | None:
        """
        加载完整认证数据

        优先使用新的 auth_{platform}.json，不存在时回退到旧 cookies_{platform}.json。
        """
        return _module_load_auth_data(self)

    async def _restore_auth_data(self) -> bool:
        """
        恢复完整认证数据到浏览器上下文

        恢复顺序（与参考产品一致）：
        1. 写入 cookies
        2. 写入 localStorage
        3. 写入 IndexedDB
        4. 页面重载

        Returns:
            True 如果恢复成功
        """
        return await _module_restore_auth_data(self)

    async def check_auth(self) -> bool:
        """
        检查认证数据是否有效

        检查层次（对应三层认证体系）：
        1. 认证文件是否存在
        2. 文件是否过期（7天阈值）
        3. 实际登录验证（RPA 页面测试）

        实现委托到 ``douyin_auth.check_auth``，该模块修复了原代码中
        ``os.path.join(..., proxy=...)`` 关键字参数 bug。
        """
        return await _module_check_auth(self)

    # ═══════════════════════════════════════════════════════════
    # 发布入口（API 优先 → RPA 降级）
    # ═══════════════════════════════════════════════════════════

    async def publish(
        self,
        title: str,
        content: str = "",
        media_paths: list[str] | None = None,
        cover_path: str | None = None,
        tags: list[str] | None = None,
        draft: bool = False,
        **kwargs,
    ) -> PublishResult:
        """
        发布视频到抖音（API 优先，RPA 降级）

        发布策略（参考产品的 dual-mode 方案）：
        1. 尝试 API 模式 — 直接调用抖音 HTTP API（更快、更稳、无浏览器开销）
        2. API 失败 — 自动降级到 RPA 模式（Playwright 浏览器自动化）
        3. RPA 也失败 — 返回详细失败信息

        Args:
            title: 视频标题/文案
            content: 视频简介
            media_paths: 视频文件路径列表（抖音单次只能发 1 个）
            cover_path: 封面图路径（可选）
            tags: 标签列表
            draft: 是否保存为草稿
            **kwargs: 其他参数
        """
        start_time = time.time()
        video_path = (media_paths or [None])[0]

        if not video_path:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="未提供视频文件路径",
                duration=time.time() - start_time,
            )

        if not os.path.exists(video_path):
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error=f"视频文件不存在: {video_path}",
                duration=time.time() - start_time,
            )

        # ─── 策略 1: API 模式 ──────────────────────────
        await self._report_progress(PublishPhase.PREPARING, "准备 API 发布...", 5)
        try:
            result = await self._api_publish(
                title=title,
                content=content,
                video_path=video_path,
                cover_path=cover_path,
                tags=tags or [],
                draft=draft,
            )
            result.duration = time.time() - start_time
            logger.success(f"API 模式发布成功: {title}")
            return result
        except Exception as api_err:
            logger.warning(f"API 模式发布失败，降级到 RPA 模式: {api_err}")
            await self._report_progress(PublishPhase.PREPARING, "API 模式失败，准备 RPA 降级...", 5)

        # ─── 策略 2: RPA 模式（降级） ───────────────────
        try:
            result = await self._do_publish(
                title=title,
                content=content,
                video_path=video_path,
                cover_path=cover_path,
                tags=tags or [],
                draft=draft,
            )
            result.duration = time.time() - start_time
            return result
        except Exception as e:
            logger.exception(f"抖音发布失败（API + RPA 均失败）: {e}")
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error=str(e),
                duration=time.time() - start_time,
            )
        finally:
            await self.close()

    # ═══════════════════════════════════════════════════════════
    # API 模式发布（参考产品 dual-mode 的关键优化）
    # ═══════════════════════════════════════════════════════════

    async def _api_publish(
        self,
        title: str,
        content: str,
        video_path: str,
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """
        API 模式发布 — 直接调用抖音内部 HTTP API

        流程（从参考产品反向工程）：
        1. 加载认证数据（cookies + localStorage + IndexedDB）
        2. 获取上传授权 token
        3. 上传视频文件（multipart/form-data）
        4. 调用发布 API 创建视频

        Returns:
            PublishResult

        Raises:
            Exception: 任何步骤失败时抛出，触发 RPA 降级
        """
        import httpx

        await self._report_progress(PublishPhase.AUTHENTICATING, "加载认证数据...", 10)

        auth_data = self._load_auth_data()
        if not auth_data or not auth_data.get("cookies"):
            raise RuntimeError("没有可用的认证数据，请先登录")

        # 从 cookies 构建 cookie dict
        cookie_dict = {}
        for c in auth_data["cookies"]:
            name = c.get("name", "")
            value = c.get("value", "")
            domain = c.get("domain", "")
            if name and value and ("douyin.com" in domain or "snssdk.com" in domain):
                cookie_dict[name] = value

        # 从 localStorage 提取关键安全值用于请求头
        _ = auth_data.get("local_storage", {})
        csrf_token = cookie_dict.get("csrf_session_id", "")

        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/130.0.0.0 Safari/537.36"
            ),
            "Referer": "https://creator.douyin.com/",
            "Origin": "https://creator.douyin.com",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "zh-CN,zh;q=0.9",
        }
        if csrf_token:
            headers["X-CSRFToken"] = csrf_token

        async with httpx.AsyncClient(
            cookies=cookie_dict,
            headers=headers,
            follow_redirects=True,
            timeout=60.0,
        ) as client:
            # ── Step 1: 获取上传授权 ──────────────────────
            await self._report_progress(PublishPhase.UPLOADING, "获取上传授权...", 20)

            auth_resp = await client.get(DOUYIN_API["upload_auth"])
            if auth_resp.status_code != 200:
                raise RuntimeError(f"获取上传授权失败: HTTP {auth_resp.status_code}")

            auth_body = auth_resp.json()
            if auth_body.get("code") != 0:
                raise RuntimeError(f"获取上传授权失败: {auth_body.get('msg', 'unknown')}")

            upload_token = auth_body.get("data", {})
            logger.info(_upload_auth_log_message(auth_body.get("code"), upload_token))

            # ── Step 2: 上传视频文件 ──────────────────────
            await self._report_progress(PublishPhase.UPLOADING, "上传视频中...", 40)

            file_size = os.path.getsize(video_path)
            file_name = os.path.basename(video_path)
            logger.info(f"准备上传: {file_name} ({file_size / 1024 / 1024:.1f} MB)")

            # 使用 multipart 上传
            with open(video_path, "rb") as f:
                file_content = f.read()

            files = {
                "file": (file_name, file_content, "video/mp4"),
            }

            # 尝试构建上传请求 — 不同版本的抖音 API 使用不同的上传端点
            # 先尝试直接用 upload auth 返回的 upload_url
            upload_url = upload_token.get("upload_url") or upload_token.get("video_url", "")
            if not upload_url:
                # 没有返回上传 URL，尝试直接 POST 到 upload auth
                upload_url = DOUYIN_API["upload_auth"]

            upload_resp = await client.post(
                upload_url,
                files=files,
                timeout=300.0,
            )

            if upload_resp.status_code not in (200, 201):
                raise RuntimeError(f"视频上传失败: HTTP {upload_resp.status_code}")

            upload_result = upload_resp.json()
            video_id = (
                upload_result.get("data", {}).get("video_id")
                or upload_result.get("video_id")
                or upload_result.get("data", {}).get("item_id", "")
            )
            if not video_id:
                # 尝试从 response headers 或 text 中提取
                logger.warning(f"未从上传响应中提取到 video_id，响应: {upload_resp.text[:200]}")
                video_id = f"auto_{int(time.time())}"

            logger.info(f"视频上传完成，video_id: {video_id}")

            # ── Step 3: 调用发布 API ──────────────────────
            await self._report_progress(PublishPhase.PUBLISHING, "发布中...", 80)

            publish_payload = {
                "title": title,
                "content": content or title,
                "video_id": video_id,
                "tags": tags[:3] if tags else [],
                "is_draft": draft,
                "source": 1,  # web upload
            }

            if cover_path and os.path.exists(cover_path):
                publish_payload["cover_uri"] = cover_path

            # 尝试 create post API
            create_resp = await client.post(
                DOUYIN_API["create_post"],
                json=publish_payload,
                timeout=30.0,
            )

            if create_resp.status_code != 200:
                # 尝试备用 API
                create_resp = await client.post(
                    DOUYIN_API["post_video"],
                    json=publish_payload,
                    timeout=30.0,
                )

            create_body = create_resp.json() if create_resp.text else {}
            if create_resp.status_code == 200 and create_body.get("code") == 0:
                await self._report_progress(PublishPhase.DONE, "发布成功", 100)
                return PublishResult(
                    success=True,
                    platform=self.platform.value,
                    url="https://www.douyin.com/",
                    article_id=video_id,
                )
            else:
                raise RuntimeError(f"发布 API 返回异常: HTTP {create_resp.status_code}, body: {create_resp.text[:200]}")

    # ═══════════════════════════════════════════════════════════════
    # RPA 模式发布（增强版 — 响应拦截 + Per-Field 重试）
    # ═══════════════════════════════════════════════════════════════

    async def _do_publish(
        self,
        title: str,
        content: str,
        video_path: str,
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """
        RPA 模式发布 — Playwright 浏览器自动化

        P0 优化（参考产品风格）：
        1. ResponseMonitor — 替代 DOM 轮询，直接拦截 API 响应判断发布结果
        2. FieldRetryMap — 每个表单字段独立重试，不影响其他字段
        3. ProgressThrottle — 大文件上传进度限频
        """
        logger.info(f"开始 RPA 发布到抖音: {title}")
        await self._report_progress(PublishPhase.AUTHENTICATING, "启动浏览器...", 10)

        # 注：原代码有 bug — os.path.join 不接受 proxy 关键字参数（TypeError）
        self._context = await self._playwright_app.chromium.launch_persistent_context(
            **_build_launch_kwargs(
                user_data_dir=self._get_browser_data_dir(),
                headless=self.config.headless,
                viewport={"width": 1280, "height": 800},
                proxy=self.proxy_config,
            )
        )
        self._page = await self._context.new_page()

        # 恢复完整认证数据（cookies + localStorage + IndexedDB）
        await self._report_progress(PublishPhase.AUTHENTICATING, "恢复登录态...", 15)
        auth_ok = await self._restore_auth_data()
        if not auth_ok:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="认证数据不存在或已过期，请先登录",
            )

        # ── 初始化 API 响应监控（P0-1: 替代 DOM 轮询）
        monitor = ResponseMonitor(self._page)
        monitor.watch_patterns(
            [
                "aweme/create",
                "aweme/post",
                "upload/auth",
            ]
        )

        # ── 初始化进度节流阀（P1-1）
        throttle = ProgressThrottle()

        # ── 初始化 per-field 重试状态机（P0-2）
        # 字段列表: 每个字段单独计数，互不影响
        fields = FieldRetryMap(retry_count=5)
        for f in ("video", "title", "cover", "tags", "description", "publish_button"):
            fields.add_field(f)

        # 导航到上传页
        await self._report_progress(PublishPhase.PREPARING, "导航到上传页...", 20)
        upload_url = self._selectors["upload_page_url"]
        await self._page.goto(upload_url, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        if "/login" in self._page.url:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="认证已过期，请重新登录",
            )

        # ── RPA 主循环: per-field 重试状态机
        upload_start_time = time.time()
        file_size = os.path.getsize(video_path)
        file_size_mb = file_size / 1024 / 1024

        while fields.has_unfinished:
            for field in list(fields.unfinished_fields):
                try:
                    if field == "video":
                        await rpa_do_video_upload(
                            self._page,
                            self._selectors,
                            self._report_progress,
                            video_path,
                            file_size_mb,
                            throttle,
                            self._upload_wait_timeout,
                        )
                        fields.mark_done("video")

                    elif field == "title":
                        await rpa_do_field_title(
                            self._page, self._selectors, self._report_progress, title, fields, throttle
                        )
                        fields.mark_done("title")

                    elif field == "cover":
                        if cover_path and os.path.exists(cover_path):
                            await rpa_do_field_cover(
                                self._page, self._selectors, self._report_progress, cover_path, fields, throttle
                            )
                        fields.mark_done("cover")

                    elif field == "tags":
                        if tags:
                            await rpa_do_field_tags(
                                self._page, self._selectors, self._report_progress, tags, fields, throttle
                            )
                        fields.mark_done("tags")

                    elif field == "description":
                        if content:
                            await rpa_do_field_desc(
                                self._page, self._selectors, self._report_progress, content, fields, throttle
                            )
                        fields.mark_done("description")

                    elif field == "publish_button":
                        await rpa_do_publish_click(
                            self._page, self._selectors, self._report_progress, draft, fields, monitor, throttle
                        )
                        fields.mark_done("publish_button")

                except Exception as e:
                    can_retry = fields.retry(field)
                    retries_left = 5 - fields._map[field]
                    logger.warning(
                        f"[{field}] 操作失败: {e}"
                        + (f"，剩余 {retries_left} 次重试" if can_retry else "，已耗尽重试次数")
                    )
                    if can_retry:
                        await asyncio.sleep(2)
                    else:
                        logger.error(f"[{field}] 重试耗尽，跳过此字段")

            # 所有字段完成后退出循环
            if fields.all_done:
                break

        # ── 验证发布结果
        # P0-1: 先查 API 响应，再查 DOM
        api_data = monitor.all_responses
        publish_success = False
        publish_url = "https://www.douyin.com/"

        if api_data:
            logger.info(f"已捕获 {len(api_data)} 个 API 响应，用于验证发布结果")
            for r in api_data:
                data = r.get("data", {})
                url = r.get("url", "")
                if isinstance(data, dict) and data.get("code") == 0:
                    publish_success = True
                    item_id = data.get("data", {}).get("item_id", "")
                    if item_id:
                        publish_url = f"https://www.douyin.com/video/{item_id}"
                        logger.success(f"API 确认发布成功: {publish_url}")
                    else:
                        logger.success(f"API 确认发布成功（code=0）: {url}")
                    break
                elif isinstance(data, dict) and "error" in data:
                    logger.warning(f"API 返回错误: {data.get('error', data)}")

        if not publish_success:
            # 回退: 检查 URL 是否已跳转
            try:
                current_url = self._page.url
                if "success" in current_url or "publish/success" in current_url:
                    publish_success = True
                    logger.info("页面 URL 确认发布成功")
            except Exception:
                pass

        if not publish_success:
            # 二次回退: 检查 DOM
            try:
                success_el = await self._page.locator(self._selectors["upload_complete"]).count()
                if success_el > 0:
                    publish_success = True
                    logger.info("DOM 元素确认发布成功")
            except Exception:
                pass

        duration = time.time() - upload_start_time

        if publish_success or fields.is_done("publish_button"):
            logger.success(f"抖音 RPA 发布完成: {title} ({duration:.0f}s)")
            await self._report_progress(PublishPhase.DONE, "发布完成", 100)
            return PublishResult(
                success=True,
                platform=self.platform.value,
                url=publish_url,
                duration=duration,
            )
        else:
            await self._report_progress(PublishPhase.FAILED, "发布失败", 100)
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="RPA 发布失败：所有字段重试耗尽或无法确认发布结果",
                duration=duration,
            )

        # RPA 子操作已提取到 douyin_rpa_fields.py

    async def _do_publish_legacy(
        self,
        title: str,
        content: str,
        video_path: str,
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """
        RPA 模式发布 — 原始版本，保留作回退

        与 _do_publish 的区别：
        - 无 ResponseMonitor（DOM 轮询）
        - 无 FieldRetryMap（全局重试）
        - 仅用于新版本出现异常时降级
        """
        logger.info(f"开始 RPA 发布到抖音（回退模式）: {title}")
        await self._report_progress(PublishPhase.AUTHENTICATING, "启动浏览器...", 10)

        # 注：原代码有 bug — os.path.join 不接受 proxy 关键字参数（TypeError）
        self._context = await self._playwright_app.chromium.launch_persistent_context(
            **_build_launch_kwargs(
                user_data_dir=self._get_browser_data_dir(),
                headless=self.config.headless,
                viewport={"width": 1280, "height": 800},
                proxy=self.proxy_config,
            )
        )
        self._page = await self._context.new_page()

        await self._report_progress(PublishPhase.AUTHENTICATING, "恢复登录态...", 15)
        auth_ok = await self._restore_auth_data()
        if not auth_ok:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="认证数据不存在或已过期，请先登录",
            )

        await self._report_progress(PublishPhase.PREPARING, "导航到上传页...", 20)
        upload_url = self._selectors["upload_page_url"]
        await self._page.goto(upload_url, wait_until="domcontentloaded")
        await asyncio.sleep(3)

        if "/login" in self._page.url:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error="认证已过期，请重新登录",
            )

        await self._report_progress(PublishPhase.UPLOADING, "上传视频中...", 30)
        try:
            file_input = self._page.locator(self._selectors["upload_input"]).first
            await file_input.set_input_files(video_path)
        except Exception as e:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error=f"视频上传失败: {e}",
            )

        await self._report_progress(PublishPhase.UPLOADING, "等待上传完成...", 50)
        try:
            await self._page.wait_for_selector(
                self._selectors["upload_complete"],
                timeout=self._upload_wait_timeout * 1000,
            )
        except Exception:
            logger.warning("未检测到上传完成标志，等待 30 秒...")
            await asyncio.sleep(30)

        await self._report_progress(PublishPhase.PUBLISHING, "填写标题...", 70)
        try:
            title_input = self._page.locator(self._selectors["title_input"]).first
            await title_input.fill(title)
        except Exception as e:
            return PublishResult(
                success=False,
                platform=self.platform.value,
                error=f"填写标题失败: {e}",
            )

        if cover_path and os.path.exists(cover_path):
            try:
                cover_btn = self._page.locator(self._selectors["cover_upload"]).first
                await cover_btn.click()
                await asyncio.sleep(2)
                cover_input = self._page.locator(self._selectors["cover_input"]).first
                await cover_input.set_input_files(cover_path)
                logger.info("封面图已上传")
            except Exception as e:
                logger.warning(f"封面上传失败（不影响发布）: {e}")

        if tags:
            try:
                tag_input = self._page.locator(self._selectors["tag_input"]).first
                for tag in tags[:3]:
                    await tag_input.fill(tag)
                    await asyncio.sleep(1)
                    tag_item = self._page.locator(self._selectors["tag_item"]).first
                    if await tag_item.count() > 0:
                        await tag_item.click()
                    await asyncio.sleep(0.5)
            except Exception as e:
                logger.warning(f"标签添加失败（不影响发布）: {e}")

        if content:
            try:
                desc_input = self._page.locator(self._selectors["description_textarea"]).first
                if await desc_input.count() > 0:
                    await desc_input.fill(content)
            except Exception as e:
                logger.warning(f"简介填写失败（不影响发布）: {e}")

        await self._report_progress(PublishPhase.PUBLISHING, "点击发布...", 90)
        if draft:
            draft_btn = self._page.locator(self._selectors["draft_button"])
            if await draft_btn.count() > 0:
                await draft_btn.first.click()
            else:
                publish_btn = self._page.locator(self._selectors["publish_button"]).first
                await publish_btn.click()
        else:
            try:
                publish_btn = self._page.locator(self._selectors["publish_button"]).first
                await publish_btn.click(timeout=10000)
            except Exception:
                publish_btn_alt = self._page.locator(self._selectors["publish_button_alt"]).first
                if await publish_btn_alt.count() > 0:
                    await publish_btn_alt.click()
                else:
                    raise

        await asyncio.sleep(5)
        await self._report_progress(PublishPhase.DONE, "发布完成", 100)
        logger.info(f"抖音 RPA 发布完成（回退模式）: {title}")

        return PublishResult(
            success=True,
            platform=self.platform.value,
            url="https://www.douyin.com/",
        )

    # ═══════════════════════════════════════════════════════════════
    # 资源管理
    # ═══════════════════════════════════════════════════════════════

    async def close(self):
        """释放资源"""
        try:
            if self._context:
                await self._context.close()
        except Exception:
            pass
        self._context = None
        self._page = None
        try:
            if self._playwright_app:
                await self._playwright_app.stop()
        except Exception:
            pass
        logger.info("抖音发布器已关闭")
