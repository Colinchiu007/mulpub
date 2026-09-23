"""小红书发布器（RPA 模式）

使用 Playwright 自动化浏览器发布图文/视频到小红书创作平台。
实现参照 douyin.py 的 _do_publish_legacy RPA 流程。
"""

from __future__ import annotations

import asyncio
import os

from loguru import logger

from multi_publish.models import PlatformType, PublishPhase, PublishResult
from multi_publish.publishers.base import BasePublisher, PublisherConfig, wait_until
from multi_publish.publishers.legacy_auth_policy import require_legacy_plaintext_auth

DEFAULT_SELECTORS = {
    "login_qrcode": '[class*="qrcode"]',
    "login_success_indicator": '[class*="creator-home"]',
    "upload_page_url": "https://creator.xiaohongshu.com/publish/publish",
    "upload_input": 'input[type="file"]',
    "title_input": '[class*="title"] input, [placeholder*="标题"]',
    "content_textarea": '[class*="content"] textarea, [class*="desc"] textarea, [placeholder*="正文"]',
    "publish_button": 'button:has-text("发布"), button:has-text("发布笔记")',
    "tag_input": '[class*="tag"] input, [placeholder*="标签"]',
    "cover_upload": '[class*="cover"]',
    "cover_input": 'input[type="file"]',
    "upload_progress": '[class*="progress"]',
    "upload_complete": '[class*="upload-success"]',
    "draft_button": 'button:has-text("草稿")',
}

CREATOR_URL = "https://creator.xiaohongshu.com/"

# 脆弱等待改造（体检报告 P2「脆弱等待」）：固定 sleep 换成条件轮询 + 具名上限。
# 超时原因统一为「站点结构变化 / 上传未完成导致选择器不命中」，因此超时只记日志、
# 不直接判发布失败（原固定 sleep 也是继续往下走，这里不新增失败路径）。
NAVIGATE_READY_TIMEOUT_S = 10.0
NAVIGATE_READY_POLL_INTERVAL_S = 0.5
UPLOAD_FALLBACK_WAIT_TIMEOUT_S = 30.0
UPLOAD_FALLBACK_POLL_INTERVAL_S = 0.5


class XiaoHongShuPublisher(BasePublisher):
    """小红书发布器（RPA 模式）"""

    def __init__(self, config: PublisherConfig, account_id: str | None = None):
        super().__init__(config, account_id=account_id)
        self._configure_account_storage()
        self._browser = None
        self._context = None
        self._page = None
        self._playwright = None
        self.selectors = dict(DEFAULT_SELECTORS)
        self.creator_url = CREATOR_URL
        self._login_timeout = 120
        self._publish_timeout = 300
        self._upload_wait_timeout = 600

    @property
    def platform(self) -> PlatformType:
        return PlatformType.XIAOHONGSHU

    async def initialize(self):
        pass

    async def _ensure_browser(self):
        if self._page:
            return
        from playwright.async_api import async_playwright

        self._playwright_app = await async_playwright().start()
        self._context = await self._playwright_app.chromium.launch_persistent_context(
            user_data_dir=self._get_browser_data_dir(),
            headless=self.config.headless,
            viewport={"width": 1280, "height": 800},
        )
        self._page = await self._context.new_page()
        await self._restore_auth_data()

    async def login(self) -> bool:
        """打开浏览器等待用户扫码登录"""
        await self._ensure_browser()
        logger.info("小红书：请扫码登录")
        await self._page.goto(self.creator_url, wait_until="domcontentloaded")
        for _ in range(self._login_timeout):
            await asyncio.sleep(1)
            if self.creator_url.rstrip("/") in self._page.url:
                logger.success("小红书登录成功")
                await self._save_auth_data()
                return True
        logger.warning("小红书登录超时")
        return False

    async def check_auth(self) -> bool:
        try:
            await self._ensure_browser()
            if not self._page:
                return False
            await self._page.goto(self.creator_url, wait_until="domcontentloaded")
            await asyncio.sleep(2)
            if "/login" in self._page.url:
                return False
            return True
        except Exception:
            return False

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
        logger.info(f"[小红书] 开始发布: {title}")
        if not title:
            return PublishResult(success=False, platform="xiaohongshu", error="标题不能为空")
        await self._report_progress(PublishPhase.PREPARING, "准备发布...", 5)
        try:
            return await self._do_publish_rpa(
                title=title,
                content=content,
                media_paths=media_paths or [],
                cover_path=cover_path,
                tags=tags or [],
                draft=draft,
            )
        except Exception as e:
            logger.error(f"[小红书] 发布失败: {e}")
            return PublishResult(success=False, platform="xiaohongshu", error=f"发布失败: {e}")

    async def _do_publish_rpa(
        self,
        title: str,
        content: str,
        media_paths: list[str],
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """RPA 发布核心流程"""
        await self._report_progress(PublishPhase.AUTHENTICATING, "启动浏览器...", 10)

        from playwright.async_api import async_playwright

        self._playwright_app = await async_playwright().start()
        self._context = await self._playwright_app.chromium.launch_persistent_context(
            user_data_dir=self._get_browser_data_dir(),
            headless=self.config.headless,
            viewport={"width": 1280, "height": 800},
        )
        self._page = await self._context.new_page()

        await self._report_progress(PublishPhase.AUTHENTICATING, "恢复登录态...", 15)
        auth_ok = await self._restore_auth_data()
        if not auth_ok:
            return PublishResult(
                success=False,
                platform="xiaohongshu",
                error="认证数据不存在或已过期，请先登录",
            )

        await self._report_progress(PublishPhase.PREPARING, "导航到上传页...", 20)
        upload_url = self.selectors["upload_page_url"]
        await self._page.goto(upload_url, wait_until="domcontentloaded")
        # 上传页是 SPA，原固定 sleep(3)：控件未挂载时 3s 不够、挂载快时白等。
        # 改为等上传文件控件真正可见。
        upload_input_ready = await wait_until(
            lambda: self._page.locator(self.selectors["upload_input"]).first.is_visible(),
            timeout_s=NAVIGATE_READY_TIMEOUT_S,
            interval_s=NAVIGATE_READY_POLL_INTERVAL_S,
        )
        if not upload_input_ready:
            logger.warning(
                "上传控件 %s 在 %ss 内未可见（原因：页面未完成首屏渲染或站点结构变化），继续按当前页面状态执行",
                self.selectors["upload_input"],
                NAVIGATE_READY_TIMEOUT_S,
            )

        if "/login" in self._page.url:
            return PublishResult(
                success=False,
                platform="xiaohongshu",
                error="认证已过期，请重新登录",
            )

        await self._report_progress(PublishPhase.UPLOADING, "上传媒体文件...", 30)
        try:
            file_input = self._page.locator(self.selectors["upload_input"]).first
            if media_paths:
                await file_input.set_input_files(media_paths)
        except Exception as e:
            return PublishResult(
                success=False,
                platform="xiaohongshu",
                error=f"媒体上传失败: {e}",
            )

        await self._report_progress(PublishPhase.UPLOADING, "等待上传完成...", 50)
        try:
            await self._page.wait_for_selector(
                self.selectors["upload_complete"],
                timeout=self._upload_wait_timeout * 1000,
            )
        except Exception:
            # 原实现无条件 sleep(30)：不论上传是否已完成都硬等半分钟。
            # 改为轮询「编辑器就绪」（标题输入框可见即已进入可填写状态），
            # 上限沿用原 30s，不放宽容忍度，只是让快路径提前返回。
            logger.warning(
                "未检测到上传完成标志 %s，改为轮询编辑器就绪（上限 %ss，间隔 %ss）",
                self.selectors["upload_complete"],
                UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
                UPLOAD_FALLBACK_POLL_INTERVAL_S,
            )
            editor_ready = await wait_until(
                lambda: self._page.locator(self.selectors["title_input"]).first.is_visible(),
                timeout_s=UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
                interval_s=UPLOAD_FALLBACK_POLL_INTERVAL_S,
            )
            if not editor_ready:
                logger.warning(
                    "编辑器在 %ss 内未就绪（原因：媒体上传未完成或站点结构变化），继续尝试填写标题",
                    UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
                )

        await self._report_progress(PublishPhase.PUBLISHING, "填写标题...", 70)
        try:
            title_input = self._page.locator(self.selectors["title_input"]).first
            await title_input.fill(title)
        except Exception as e:
            return PublishResult(
                success=False,
                platform="xiaohongshu",
                error=f"填写标题失败: {e}",
            )

        if cover_path and os.path.exists(cover_path):
            try:
                cover_btn = self._page.locator(self.selectors["cover_upload"]).first
                await cover_btn.click()
                await asyncio.sleep(2)
                cover_input = self._page.locator(self.selectors["cover_input"]).first
                await cover_input.set_input_files(cover_path)
                logger.info("封面图已上传")
            except Exception as e:
                logger.warning(f"封面上传失败（不影响发布）: {e}")

        if tags:
            try:
                tag_input = self._page.locator(self.selectors["tag_input"]).first
                for tag in tags[:5]:
                    await tag_input.fill(tag)
                    await asyncio.sleep(0.5)
            except Exception as e:
                logger.warning(f"标签添加失败（不影响发布）: {e}")

        if content:
            try:
                content_area = self._page.locator(self.selectors["content_textarea"]).first
                if await content_area.count() > 0:
                    await content_area.fill(content)
            except Exception as e:
                logger.warning(f"正文填写失败（不影响发布）: {e}")

        await self._report_progress(PublishPhase.PUBLISHING, "点击发布...", 90)
        if draft:
            draft_btn = self._page.locator(self.selectors["draft_button"])
            if await draft_btn.count() > 0:
                await draft_btn.first.click()
            else:
                publish_btn = self._page.locator(self.selectors["publish_button"]).first
                await publish_btn.click()
        else:
            publish_btn = self._page.locator(self.selectors["publish_button"]).first
            await publish_btn.click(timeout=10000)

        await asyncio.sleep(5)
        await self._report_progress(PublishPhase.DONE, "发布完成", 100)
        logger.info(f"[小红书] RPA 发布完成: {title}")

        return PublishResult(
            success=True,
            platform="xiaohongshu",
            url="https://creator.xiaohongshu.com/",
        )

    async def _save_auth_data(self):
        require_legacy_plaintext_auth()
        if not self._context or not self._page:
            return
        try:
            cookies = await self._context.cookies()
            local_storage = await self._page.evaluate("JSON.stringify(localStorage)")
            import json

            data = {
                "cookies": cookies,
                "local_storage": json.loads(local_storage) if local_storage else {},
                "captured_at": __import__("time").time(),
            }
            os.makedirs(os.path.dirname(self._auth_data_path), exist_ok=True)
            with open(self._auth_data_path, "w", encoding="utf-8") as f:
                json.dump(data, f)
            logger.info("认证数据已保存")
        except Exception as e:
            logger.warning(f"保存认证数据失败: {e}")

    async def _restore_auth_data(self) -> bool:
        require_legacy_plaintext_auth()
        import json

        if not os.path.exists(self._auth_data_path):
            if not os.path.exists(self._cookie_path):
                return False
            return await self._restore_cookies_legacy()
        try:
            with open(self._auth_data_path, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("cookies"):
                await self._context.add_cookies(data["cookies"])
            if data.get("local_storage") and self._page:
                for key, value in data["local_storage"].items():
                    try:
                        await self._page.evaluate("localStorage.setItem(arguments[0], arguments[1])", key, value)
                    except Exception:
                        pass
            logger.info("认证数据已恢复")
            return True
        except Exception as e:
            logger.warning(f"恢复认证数据失败: {e}")
            return False

    async def _restore_cookies_legacy(self) -> bool:
        require_legacy_plaintext_auth()
        import json

        try:
            with open(self._cookie_path, encoding="utf-8") as f:
                cookies = json.load(f)
            await self._context.add_cookies(cookies)
            logger.info("Cookie 已恢复（旧格式）")
            return True
        except Exception as e:
            logger.warning(f"恢复 Cookie 失败: {e}")
            return False

    async def close(self):
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
        self._playwright_app = None
        logger.info("小红书发布器已关闭")
