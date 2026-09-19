"""浏览器降级采集 — Playwright 访问视频页并监听平台 API 拿播放地址。

背景：yt-dlp 对抖音报 Fresh cookies needed（2026.8.19 实测），纯 HTTP 通道被风控。
本模块用 Playwright 桌面 Chrome 访问视频页，监听平台 detail API 响应提取
play_addr url_list，带 Referer 下载（已实测：65s 抖音视频全链路 35s 跑通）。

设计约束：
- 懒加载：首次调用才启动浏览器，避免影响 Python 后端启动速度
- 超时兜底：页面加载/API 等待/下载各有独立超时，任一超时抛 BrowserFetchError
- 反爬友好：桌面 Chrome UA + 真实视口 + zh-CN locale，模拟真实用户
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import urllib.request
from pathlib import Path

logger = logging.getLogger(__name__)

# 各平台「浏览器降级」配置：视频页 URL 模板 + 要监听的 API URL 子串 + 响应解析路径
_BROWSER_FETCH_CONFIGS: dict[str, dict] = {
    "douyin": {
        # 从任意抖音 URL 提取视频 ID（/video/{id}、share/video/{id}、?modal_id= 等）
        "id_patterns": [
            r"douyin\.com/video/(\d+)",
            r"douyin\.com/share/video/(\d+)",
            r"douyin\.com/(?:note|user/.*)?\?.*modal_id=(\d+)",
            r"iesdouyin\.com/share/video/(\d+)",
        ],
        "page_url": "https://www.douyin.com/video/{video_id}",
        "api_pattern": "aweme/v1/web/aweme/detail",
        # 响应 JSON 路径：aweme_detail -> video -> play_addr -> url_list
        "play_path": ("aweme_detail", "video", "play_addr", "url_list"),
        "title_path": ("aweme_detail", "desc"),
        "author_path": ("aweme_detail", "author", "nickname"),
        "duration_path": ("aweme_detail", "duration"),  # 毫秒
        "duration_unit_ms": True,
        "referer": "https://www.douyin.com/",
    },
}

# 通用桌面 Chrome UA（与 Node 侧 stealth 通道一致的形态）
_DESKTOP_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

_PAGE_TIMEOUT_MS = 30_000   # 页面加载超时
_API_WAIT_MS = 12_000       # 等待目标 API 响应的超时
_DOWNLOAD_TIMEOUT_SEC = 180 # 视频下载超时


class BrowserFetchError(Exception):
    """浏览器降级采集错误。code: no_browser / fetch_failed / download_failed"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def extract_video_id(url: str, platform: str) -> str | None:
    """从平台 URL 提取视频 ID（用于构造桌面版视频页地址）。"""
    config = _BROWSER_FETCH_CONFIGS.get(platform)
    if not config:
        return None
    for pattern in config["id_patterns"]:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None


def resolve_short_link(url: str) -> str:
    """解析短链（v.douyin.com/xxx 等）到最终视频页 URL。

    短链 302 到 iesdouyin share 页，Location 含视频 ID；
    不跟随多次重定向（只取一层 Location），避免意外跳转。
    解析失败原样返回，由上层报错。
    """
    try:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
        if not any(host == d or host.endswith("." + d) for d in ("v.douyin.com", "xhslink.com")):
            return url

        class _NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None

        req = urllib.request.Request(
            url,
            headers={"User-Agent": _DESKTOP_UA},
            method="HEAD",
        )
        opener = urllib.request.build_opener(_NoRedirect)
        try:
            opener.open(req, timeout=10)
            return url  # 无重定向，原样返回
        except urllib.error.HTTPError as e:
            if 300 <= e.code < 400:
                location = e.headers.get("Location") or ""
                if location.startswith(("http://", "https://")):
                    return location
            return url
    except Exception:
        return url


def _dig(data, path: tuple) -> object:
    """按路径逐层取 JSON 嵌套值，任一层缺失返回 None。"""
    cur = data
    for key in path:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(key)
    return cur


async def _fetch_via_browser_async(platform: str, video_id: str) -> dict:
    """Playwright 访问视频页，监听 detail API 拿元数据 + 播放地址。"""
    config = _BROWSER_FETCH_CONFIGS[platform]
    page_url = config["page_url"].format(video_id=video_id)
    api_pattern = config["api_pattern"]

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        raise BrowserFetchError(
            "no_browser",
            "浏览器采集组件未安装（playwright），请运行: pip install playwright && playwright install chromium",
        )

    captured: list[str] = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        try:
            context = await browser.new_context(
                user_agent=_DESKTOP_UA,
                viewport={"width": 1280, "height": 800},
                locale="zh-CN",
            )
            page = await context.new_page()

            async def on_response(resp):
                if api_pattern in resp.url:
                    try:
                        captured.append(await resp.text())
                    except Exception:
                        pass

            page.on("response", on_response)
            await page.goto(page_url, wait_until="domcontentloaded", timeout=_PAGE_TIMEOUT_MS)
            # 等待 detail API 响应到达（页面加载后异步触发）
            for _ in range(_API_WAIT_MS // 500):
                if captured:
                    break
                await page.wait_for_timeout(500)

            if not captured:
                raise BrowserFetchError(
                    "fetch_failed",
                    "未能从页面获取视频信息（平台可能要求登录或链接已失效）",
                )
        finally:
            await browser.close()

    try:
        data = json.loads(captured[0])
    except json.JSONDecodeError:
        raise BrowserFetchError("fetch_failed", "视频信息解析失败")

    urls = _dig(data, config["play_path"]) or []
    if not urls or not isinstance(urls, list):
        raise BrowserFetchError("fetch_failed", "未能获取视频播放地址")

    duration_raw = _dig(data, config["duration_path"])
    duration = 0.0
    if isinstance(duration_raw, (int, float)):
        duration = duration_raw / 1000.0 if config.get("duration_unit_ms") else float(duration_raw)

    return {
        "title": str(_dig(data, config["title_path"]) or "").strip(),
        "author": str(_dig(data, config["author_path"]) or "").strip(),
        "duration": duration,
        "play_url": urls[0],
        "referer": config["referer"],
    }


def fetch_video_via_browser(platform: str, url: str) -> dict:
    """同步入口：浏览器降级采集视频元数据 + 播放地址。

    返回 {title, author, duration, play_url, referer}。
    失败抛 BrowserFetchError（no_browser / fetch_failed / download_failed）。
    """
    # 短链先解析到最终页（v.douyin.com/xxx -> iesdouyin share/video/{id}）
    resolved = resolve_short_link(url)
    video_id = extract_video_id(resolved, platform)
    if not video_id:
        raise BrowserFetchError(
            "fetch_failed",
            "无法从链接提取视频 ID，请粘贴完整的视频分享链接",
        )
    try:
        return asyncio.run(_fetch_via_browser_async(platform, video_id))
    except BrowserFetchError:
        raise
    except Exception as e:
        raise BrowserFetchError("fetch_failed", f"浏览器采集失败: {e}")


def download_video_file(play_url: str, referer: str, target: Path) -> None:
    """带 Referer 的视频下载（抖音 CDN 校验 Referer，缺失返回 403）。"""
    req = urllib.request.Request(
        play_url,
        headers={"User-Agent": _DESKTOP_UA, "Referer": referer},
    )
    try:
        with urllib.request.urlopen(req, timeout=_DOWNLOAD_TIMEOUT_SEC) as resp, open(target, "wb") as f:
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                f.write(chunk)
    except Exception as e:
        raise BrowserFetchError("download_failed", f"视频下载失败: {e}")
    if not target.exists() or target.stat().st_size == 0:
        raise BrowserFetchError("download_failed", "视频下载失败（文件为空）")
