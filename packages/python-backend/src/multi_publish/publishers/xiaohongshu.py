"""小红书发布器（RPA / DOM 轨）

使用 Playwright 自动化浏览器把图文/视频保存进小红书创作平台。

设计要点（rpa-xiaohongshu-dom-hardening）：
- 验收目标为「存入真实草稿箱」，成功判定来自正面确认信号（ResponseMonitor 捕获
  草稿保存端点响应，或草稿箱回查命中），绝不盲 sleep 后无条件报成功、绝不伪造 url。
- 草稿意图 fail-closed：找不到草稿入口一律报错并阻止任何公开发布点击。
- 发布步骤逻辑与真实浏览器启动解耦（_execute_flow 接收注入的 page + monitor），
  可在假对象下单测核心分支。
- 合规红线：运行时不请求任何外部远程求签服务（禁引入外包签名农场域名）。

常量见 xiaohongshu_selectors.py；认证持久化见 xiaohongshu_auth.py；
底层控件操作（纯函数）见 xiaohongshu_dom.py。
实现参照 douyin.py 的「先查 API 响应、再 URL、再 DOM」三级回退确认范式。
"""

from __future__ import annotations

import asyncio
import os

from loguru import logger

from multi_publish.models import PlatformType, PublishPhase, PublishResult
from multi_publish.publishers import xiaohongshu_dom as dom
from multi_publish.publishers.base import BasePublisher, PublisherConfig, ResponseMonitor
from multi_publish.publishers.xiaohongshu_auth import XiaohongshuAuthMixin
from multi_publish.publishers.xiaohongshu_selectors import (
    CODE_DRAFT_ENTRY_MISSING,
    CODE_LOGIN_EXPIRED,
    CODE_RISK_BLOCKED,
    CODE_TITLE_FAILED,
    CODE_UNCONFIRMED,
    CODE_UPLOAD_FAILED,
    CONFIRM_TIMEOUT_S,
    CREATOR_URL,
    DEFAULT_SELECTORS,
    DRAFT_BOX_ITEM_SELECTOR,
    DRAFT_BOX_URL,
    DRAFT_SAVE_RESPONSE_PATTERNS,
    NAVIGATE_READY_POLL_INTERVAL_S,
    NAVIGATE_READY_TIMEOUT_S,
    RISK_HOST_PROBE_LIMIT,
    RISK_HOST_SCAN_LIMIT,
    RISK_OVERLAY_SELECTOR,
    RISK_TEXT_HOSTS,
    RISK_TEXT_PATTERN,
    SELECTOR_FALLBACKS,
    UPLOAD_FALLBACK_POLL_INTERVAL_S,
    UPLOAD_FALLBACK_WAIT_TIMEOUT_S,
)
from multi_publish.publishers.xiaohongshu_selectors import (
    coded as _coded,
)


class XiaoHongShuPublisher(BasePublisher, XiaohongshuAuthMixin):
    """小红书发布器（RPA / DOM 轨）"""

    def __init__(self, config: PublisherConfig, account_id: str | None = None):
        super().__init__(config, account_id=account_id)
        self._configure_account_storage()
        self._browser = None
        self._context = None
        self._page = None
        self._playwright = None
        self._playwright_app = None
        self.selectors = dict(DEFAULT_SELECTORS)
        self.selector_fallbacks = dict(SELECTOR_FALLBACKS)
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
            return PublishResult(success=False, platform="xiaohongshu", error=_coded(CODE_UNCONFIRMED, f"发布异常: {e}"))

    async def _do_publish_rpa(
        self,
        title: str,
        content: str,
        media_paths: list[str],
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """启动真实浏览器 + 恢复登录态，再委托可桩的 _execute_flow。"""
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
                error=_coded(CODE_LOGIN_EXPIRED, "认证数据不存在或已过期，请先登录"),
            )
        return await self._execute_flow(
            self._page,
            ResponseMonitor(self._page),
            title=title,
            content=content,
            media_paths=media_paths,
            cover_path=cover_path,
            tags=tags,
            draft=draft,
        )

    async def _execute_flow(
        self,
        page,
        monitor,
        *,
        title: str,
        content: str,
        media_paths: list[str],
        cover_path: str | None,
        tags: list[str],
        draft: bool,
    ) -> PublishResult:
        """发布编排核心：接收注入的 page + monitor，无真实浏览器亦可单测。"""
        await self._report_progress(PublishPhase.PREPARING, "导航到上传页...", 20)
        await page.goto(self.selectors["upload_page_url"], wait_until="domcontentloaded")

        if self._is_login_redirect(getattr(page, "url", "")):
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_LOGIN_EXPIRED, "认证已过期，请重新登录"),
            )

        try:
            if DRAFT_SAVE_RESPONSE_PATTERNS:
                monitor.watch_patterns(list(DRAFT_SAVE_RESPONSE_PATTERNS))
        except Exception as e:
            logger.warning(f"ResponseMonitor 注册失败（降级为回查兜底）: {e}")

        if await self._risk_present(page):
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_RISK_BLOCKED, "检测到风控/验证弹层，已停止"),
            )

        await self._report_progress(PublishPhase.UPLOADING, "上传媒体文件...", 30)
        if media_paths:
            file_input = await self._await_upload_input(page)
            if file_input is None:
                return PublishResult(
                    success=False, platform="xiaohongshu",
                    error=_coded(
                        CODE_UPLOAD_FAILED,
                        f"上传控件在 {UPLOAD_FALLBACK_WAIT_TIMEOUT_S}s 内未挂载，已停止而非静默跳过媒体",
                    ),
                )
            try:
                await file_input.set_input_files(media_paths)
            except Exception as e:
                return PublishResult(
                    success=False, platform="xiaohongshu",
                    error=_coded(CODE_UPLOAD_FAILED, f"媒体上传失败: {e}"),
                )
        await self._await_editor_ready(page)

        await self._report_progress(PublishPhase.PUBLISHING, "填写标题...", 70)
        if not await self._set_field(page, "title_input", title):
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_TITLE_FAILED, "填写标题失败（选择器未命中或控件不可写）"),
            )

        if content:
            await self._set_field(page, "content_textarea", content)
        if tags:
            await self._add_tags(page, tags)
        if cover_path and os.path.exists(cover_path):
            await self._set_cover(page, cover_path)

        await self._report_progress(PublishPhase.PUBLISHING, "保存草稿...", 90)
        if draft:
            return await self._save_as_draft(page, monitor, title)
        return await self._publish_public(page, monitor, title)

    async def _save_as_draft(self, page, monitor, title: str) -> PublishResult:
        """草稿 fail-closed：找不到草稿入口绝不 fallthrough 到公开发布。"""
        draft_btn, _ = await self._resolve_visible(page, "draft_button")
        if draft_btn is None:
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_DRAFT_ENTRY_MISSING, "未找到草稿保存入口，已阻止公开发布"),
            )
        await draft_btn.click()
        return await self._confirm_saved(page, monitor, title, kind="草稿")

    async def _publish_public(self, page, monitor, title: str) -> PublishResult:
        """真实公开发布（非默认验收路径），同样确认才报成功。"""
        publish_btn, _ = await self._resolve_visible(page, "publish_button")
        if publish_btn is None:
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_UNCONFIRMED, "未找到发布按钮，未执行公开发布"),
            )
        await publish_btn.click()
        return await self._confirm_saved(page, monitor, title, kind="发布")

    async def _confirm_saved(self, page, monitor, title: str, *, kind: str) -> PublishResult:
        """确认才成功：优先 XHR 响应，回退 URL 显式跳转，再回退草稿箱回查；均无 → 未确认失败。"""
        confirmed, url = False, None

        if DRAFT_SAVE_RESPONSE_PATTERNS:
            data = await monitor.wait_for_response(timeout=CONFIRM_TIMEOUT_S, predicate=self._resp_success)
            if data is not None and self._resp_success(data):
                confirmed = True
                url = self._extract_url(data)
            elif data is not None:
                logger.warning(f"[小红书] 捕获到 {kind} 响应但非成功码: {data}")

        if not confirmed:
            cur = getattr(page, "url", "") or ""
            if "publish/success" in cur or cur.rstrip("/").endswith("/success"):
                confirmed = True
                url = url or cur

        if not confirmed:
            confirmed = await self._recheck_draft_box(page, title)
            if confirmed:
                url = url or DRAFT_BOX_URL

        await self._report_progress(PublishPhase.DONE, f"{kind}完成" if confirmed else f"{kind}未确认", 100)

        if not confirmed:
            logger.warning(f"[小红书] {kind} 无正面确认，按失败上报（不伪造成功）: {title}")
            return PublishResult(
                success=False, platform="xiaohongshu",
                error=_coded(CODE_UNCONFIRMED, f"{kind} 未获正面确认（无成功响应/URL 跳转/草稿箱回查命中）"),
            )
        logger.success(f"[小红书] {kind} 确认成功: {url}")
        return PublishResult(success=True, platform="xiaohongshu", url=url or DRAFT_BOX_URL)

    @staticmethod
    def _resp_success(data) -> bool:
        if not isinstance(data, dict):
            return False
        if data.get("code") == 0:
            return True
        return data.get("success") is True

    @staticmethod
    def _extract_url(data) -> str | None:
        if not isinstance(data, dict):
            return None
        inner = data.get("data") or {}
        if not isinstance(inner, dict):
            return None
        for key in ("draft_id", "note_id", "id", "url"):
            val = inner.get(key)
            if val:
                if key in ("draft_id", "note_id", "id"):
                    return f"{DRAFT_BOX_URL.rstrip('/')}?{key}={val}"
                return str(val)
        return None

    async def _recheck_draft_box(self, page, title: str) -> bool:
        """导航草稿箱，匹配本次标题。Tier2 取证前 DRAFT_BOX_ITEM_SELECTOR 可能不命中 → False。"""
        if not title:
            return False
        try:
            await page.goto(DRAFT_BOX_URL, wait_until="domcontentloaded")
            items = page.locator(DRAFT_BOX_ITEM_SELECTOR)
            count = await items.count()
            for i in range(count):
                txt = await items.nth(i).inner_text()
                if title[:12] and title[:12] in (txt or ""):
                    return True
            return False
        except Exception as e:
            logger.debug(f"草稿箱回查失败: {e}")
            return False

    def _candidates_for(self, key: str) -> list[str]:
        chain = self.selector_fallbacks.get(key)
        if chain:
            return list(chain)
        single = self.selectors.get(key)
        return [single] if single else []

    async def _resolve_visible(self, page, key: str):
        """按候选回退链解析首个可见 locator，返回 (locator, selector) 或 (None, None)。"""
        return await dom.resolve_visible(page, self._candidates_for(key))

    async def _set_field(self, page, key: str, text: str) -> bool:
        """标题/正文填写：优先原生 fill，contenteditable 回退 evaluate + dispatch 事件。"""
        return await dom.set_field(page, self._candidates_for(key), text, label=key)

    async def _add_tags(self, page, tags: list[str]) -> None:
        """逐个 type + 尽力选下拉首个候选（修覆盖式 fill 只留最后一个）。"""
        await dom.add_tags(
            page,
            tag_candidates=self._candidates_for("tag_input"),
            suggestion_candidates=self._candidates_for("tag_suggestion"),
            tags=tags,
        )

    async def _set_cover(self, page, cover_path: str) -> None:
        await dom.set_cover(
            page,
            upload_candidates=self._candidates_for("cover_upload"),
            input_candidates=self._candidates_for("cover_input"),
            cover_path=cover_path,
        )

    async def _await_control(self, page, key: str, *, label: str, timeout_s: float, interval_s: float):
        """轮询候选链中首个可见控件，返回 locator 或 None；超时留痕但不臆断失败。"""
        return await dom.await_control(
            page, self._candidates_for(key), key=key, label=label,
            timeout_s=timeout_s, interval_s=interval_s,
        )

    async def _await_upload_input(self, page):
        """上传控件必须真等：一次性解析在 SPA 晚挂载下返回 None，会静默跳过媒体照存草稿。

        上限沿用原 30s 上传兜底时长（常量名即其来历），只收紧快路径、不放宽容忍度。
        """
        return await self._await_control(
            page, "upload_input", label="上传控件",
            timeout_s=UPLOAD_FALLBACK_WAIT_TIMEOUT_S, interval_s=UPLOAD_FALLBACK_POLL_INTERVAL_S,
        )

    async def _await_editor_ready(self, page) -> None:
        await self._await_control(
            page, "title_input", label="编辑器",
            timeout_s=NAVIGATE_READY_TIMEOUT_S, interval_s=NAVIGATE_READY_POLL_INTERVAL_S,
        )

    async def _risk_present(self, page) -> bool:
        """风控双轨逻辑见 xiaohongshu_dom.risk_present；常量必须在此处读取后传参，
        否则 monkeypatch 本模块同名常量会静默失效（见该模块 docstring）。"""
        return await dom.risk_present(
            page,
            overlay_selector=RISK_OVERLAY_SELECTOR,
            hosts=RISK_TEXT_HOSTS,
            pattern=RISK_TEXT_PATTERN,
            limit=RISK_HOST_SCAN_LIMIT,
            probe_cap=RISK_HOST_PROBE_LIMIT,
        )

    async def _visible_texts(self, page, sel: str) -> list[str]:
        """该选择器命中的可见元素文案（收集满 RISK_HOST_SCAN_LIMIT 条可见即停，
        探测不超过 RISK_HOST_PROBE_LIMIT，防整页扫描）。"""
        return await dom.visible_texts(
            page, sel, limit=RISK_HOST_SCAN_LIMIT, probe_cap=RISK_HOST_PROBE_LIMIT
        )

    @staticmethod
    def _is_login_redirect(url: str) -> bool:
        return isinstance(url, str) and "/login" in url

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
