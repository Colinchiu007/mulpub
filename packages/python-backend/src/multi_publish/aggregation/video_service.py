"""VideoCollectService — 多平台视频作品采集服务。

管线：yt-dlp --dump-json 元数据探测 → yt-dlp 下载（失败自动降级浏览器通道）→ ffmpeg 提取 16kHz WAV → AsrEngine 转写 → CollectResult。
临时文件经 tempfile.TemporaryDirectory 自动清理。
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from pathlib import Path

from .asr_engine import AsrEngineError, get_asr_engine
from .browser_fetcher import (
    BrowserFetchError,
    download_video_file,
    fetch_video_via_browser,
)
from .models import CollectResult, CollectVideoRequest

logger = logging.getLogger(__name__)

# 资源上限（与 video-clone-engine DEFAULT_LIMITS 对齐）
MAX_FILE_SIZE_BYTES = 500 * 1024 * 1024  # 500MB
MAX_DURATION_SEC = 30 * 60               # 30 分钟
PROBE_MAX_DURATION_SEC = 10 * 60         # 探测阶段即拒绝的超长视频
TRANSCRIBE_TIMEOUT_SEC = 300             # ASR 转写超时

# 支持的平台域名（2026-09-19 扩展：B站/知乎/视频号；快手无公开视频页暂不支持）
PLATFORM_DOMAINS = {
    "douyin": ("douyin.com",),
    "xiaohongshu": ("xiaohongshu.com", "xhslink.com"),
    "bilibili": ("bilibili.com", "b23.tv"),
    "zhihu": ("zhihu.com", "zhuanlan.zhihu.com"),
    "channels": ("channels.weixin.qq.com",),
}


def _resolve_binary(env_names: list[str], fallback: str) -> str:
    """环境变量优先的二进制解析（VC_* → 通用 *_PATH → PATH 命令）。"""
    for name in env_names:
        value = os.environ.get(name)
        if value:
            return value
    return fallback


def detect_platform(url: str) -> str | None:
    """从 URL 域名检测平台（douyin/xiaohongshu），未知返回 None。"""
    from urllib.parse import urlparse
    try:
        host = (urlparse(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return None
    for platform, domains in PLATFORM_DOMAINS.items():
        for domain in domains:
            if host == domain or host.endswith("." + domain):
                return platform
    return None


def _is_private_address(host: str) -> bool:
    """内网/回环地址检测（defense-in-depth：阻止 yt-dlp 探测本地服务）。"""
    if host in ("localhost", "::1", "0.0.0.0") or host.startswith("127."):
        return True
    if host.startswith("10.") or host.startswith("192.168.") or host.startswith("169.254."):
        return True
    if host.startswith("172."):
        try:
            first_octet = int(host.split(".")[1])
            if 16 <= first_octet <= 31:
                return True
        except (IndexError, ValueError):
            pass
    return False


def classify_download_error(text: str) -> tuple[str, str]:
    """yt-dlp stderr → (错误码, 中文提示)。与 video-clone-engine classifyDownloadError 语义一致。"""
    t = str(text or "")
    if re.search(r"private|私密|不可公开|仅自己可见", t, re.I):
        return "VIDEOCLONE_LINK_PRIVATE", "该视频为私密作品，无法采集"
    if re.search(r"member|会员|membership|premium", t, re.I):
        return "VIDEOCLONE_LINK_MEMBERSHIP", "该视频为会员专属内容，无法采集"
    if re.search(r"not available in your country|地区限制|geo-restricted", t, re.I):
        return "VIDEOCLONE_LINK_REGION", "该视频受地区限制，无法采集"
    if re.search(r"captcha|风控|频控|\bbot\b|verify|验证", t, re.I):
        return "VIDEOCLONE_LINK_ANTI_BOT", "该链接触发了平台风控，请稍后重试"
    if re.search(r"fresh cookies|cookies are needed|login required|需要登录", t, re.I):
        return "VIDEOCLONE_LINK_ANTI_BOT", "该链接需要登录态才能采集，正在尝试浏览器通道"
    if re.search(r"unavailable|video not found|deleted|不存在|已删除|404", t, re.I):
        return "VIDEOCLONE_LINK_UNAVAILABLE", "视频不可用或已删除，请检查链接"
    return "VIDEOCLONE_LINK_UNAVAILABLE", "视频下载失败，请检查链接后重试"


class VideoCollectError(Exception):
    """视频采集错误。code: -6 ASR引擎不可用 / -7 转写超时 / -8 无音轨 / 其他为下载错误码。"""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _run_subprocess(cmd: list[str], timeout: int) -> subprocess.CompletedProcess:
    """运行子进程，超时抛 TimeoutExpired。windowsHide 避免弹窗。"""
    return subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )


class VideoCollectService:
    """抖音/小红书视频作品采集：下载 + 音频提取 + ASR 转写。"""

    def __init__(self):
        self._ytdlp_bin = _resolve_binary(["MP_YTDLP_PATH", "VC_YTDLP_PATH", "YTDLP_PATH"], "yt-dlp")
        self._ffmpeg_bin = _resolve_binary(["MP_FFMPEG_PATH", "VC_FFMPEG_PATH", "FFMPEG_PATH"], "ffmpeg")
        self._ffprobe_bin = _resolve_binary(["MP_FFPROBE_PATH", "VC_FFPROBE_PATH", "FFPROBE_PATH"], "ffprobe")

    def collect_video(self, request: CollectVideoRequest) -> CollectResult:
        """同步执行完整管线（调用方用 asyncio.to_thread 包裹）。"""
        url = request.url
        platform = detect_platform(url)
        if platform is None:
            raise VideoCollectError(
                "VIDEOCLONE_INVALID_PLATFORM",
                f"仅支持抖音/小红书/B站/知乎/视频号视频链接，当前链接域名不受支持: {url}",
            )
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
        if _is_private_address(host):
            raise VideoCollectError(
                "VIDEOCLONE_INVALID_PLATFORM",
                "不支持内网地址链接",
            )

        engine = get_asr_engine(request.asr_engine)
        if not engine.is_available():
            raise VideoCollectError("-6", engine.install_hint())

        with tempfile.TemporaryDirectory(prefix="mp-collect-video-") as tmp_dir:
            # ① 元数据探测 + ② 下载（yt-dlp 失败自动降级浏览器通道）
            meta, video_path = self._probe_and_download(url, platform, Path(tmp_dir) / "video.mp4")
            duration = float(meta.get("duration") or 0)
            if duration > PROBE_MAX_DURATION_SEC:
                raise VideoCollectError(
                    "VIDEOCLONE_FILE_TOO_LARGE",
                    f"视频过长（{_fmt_duration(duration)}），采集仅支持 {PROBE_MAX_DURATION_SEC // 60} 分钟内的短视频",
                )

            if video_path.stat().st_size > MAX_FILE_SIZE_BYTES:
                raise VideoCollectError(
                    "VIDEOCLONE_FILE_TOO_LARGE",
                    f"视频文件过大（{video_path.stat().st_size / 1024 / 1024:.0f}MB），上限 500MB",
                )

            # ③ 检查音轨并提取音频
            if not self._has_audio_stream(video_path):
                raise VideoCollectError("-8", "该视频无音轨，无法进行语音转写")
            audio_path = Path(tmp_dir) / "audio.wav"
            self._extract_audio(video_path, audio_path)

            # ④ ASR 转写
            try:
                result = self._transcribe_with_timeout(engine, str(audio_path))
            except asyncio.TimeoutError:
                raise VideoCollectError("-7", f"转写超时（{TRANSCRIBE_TIMEOUT_SEC} 秒），请尝试较短的短视频")
            except AsrEngineError as e:
                if e.code == "engine_unavailable":
                    raise VideoCollectError("-6", e.message)
                if e.code == "download_failed":
                    raise VideoCollectError("ASR_DOWNLOAD_FAILED", e.message)
                raise VideoCollectError("ASR_FAILED", f"语音转写失败: {e.message}")

            transcript = result.text.strip()
            if not transcript:
                raise VideoCollectError("ASR_EMPTY", "语音转写结果为空，该视频可能无清晰语音内容")

            return CollectResult(
                title=str(meta.get("title") or "").strip() or "未命名视频",
                content=transcript,
                source_url=url,
                author=str(meta.get("uploader") or meta.get("channel") or "").strip(),
                word_count=len(transcript),
                media_type="video",
                video_url=url,
                duration=duration or result.duration_seconds,
                transcript=transcript,
                metadata={
                    "platform": platform,
                    "fetch_channel": meta.get("fetch_channel") or "yt-dlp",
                    "asr_engine": result.engine,
                    "asr_language": result.language,
                    "thumbnail": meta.get("thumbnail") or "",
                    "segments": result.segments,
                },
            )

    def _probe_metadata(self, url: str) -> dict:
        """yt-dlp --dump-json 探测元数据（不下载文件）。"""
        try:
            proc = _run_subprocess(
                [self._ytdlp_bin, "--dump-json", "--no-playlist", "--no-warnings", url],
                timeout=60,
            )
        except subprocess.TimeoutExpired:
            raise VideoCollectError("VIDEOCLONE_LINK_UNAVAILABLE", "视频信息探测超时，请稍后重试")
        if proc.returncode != 0:
            code, message = classify_download_error(proc.stderr)
            raise VideoCollectError(code, message)
        try:
            return json.loads(proc.stdout)
        except json.JSONDecodeError:
            raise VideoCollectError("VIDEOCLONE_LINK_UNAVAILABLE", "视频信息解析失败，请检查链接")

    def _probe_and_download(self, url: str, platform: str, video_path: Path) -> tuple[dict, Path]:
        """元数据探测 + 下载：yt-dlp 优先，失败自动降级浏览器通道。

        降级策略（2026-09-19，抖音 Fresh cookies 实测）：
        - yt-dlp 探测/下载失败且错误分类为 ANTI_BOT（Fresh cookies/风控）时，
          尝试 Playwright 浏览器通道（访问视频页监听 detail API 拿 play_addr）
        - 浏览器通道也失败才向用户报错（保留原始错误信息）
        - 非 ANTI_BOT 错误（私密/会员/地区限制/已删除）不降级——降级也不会成功
        """
        try:
            meta = self._probe_metadata(url)
            # 探测期时长上限检查（下载前拦截，不浪费流量）
            probe_duration = float(meta.get("duration") or 0)
            if probe_duration > PROBE_MAX_DURATION_SEC:
                raise VideoCollectError(
                    "VIDEOCLONE_FILE_TOO_LARGE",
                    f"视频过长（{_fmt_duration(probe_duration)}），采集仅支持 {PROBE_MAX_DURATION_SEC // 60} 分钟内的短视频",
                )
            self._download_video(url, video_path)
            meta["fetch_channel"] = "yt-dlp"
            return meta, video_path
        except VideoCollectError as e:
            if e.code != "VIDEOCLONE_LINK_ANTI_BOT":
                raise
            logger.info(f"[video-collect] yt-dlp 被风控拦截（{e.message}），降级浏览器通道: {url}")

        # 浏览器降级通道
        try:
            browser_meta = fetch_video_via_browser(platform, url)
        except BrowserFetchError as e:
            raise VideoCollectError(
                "VIDEOCLONE_LINK_ANTI_BOT",
                f"该链接需要平台登录态，自动采集暂不可用（{e.message}）。请稍后重试或更换链接",
            )
        duration = float(browser_meta.get("duration") or 0)
        if duration > PROBE_MAX_DURATION_SEC:
            raise VideoCollectError(
                "VIDEOCLONE_FILE_TOO_LARGE",
                f"视频过长（{_fmt_duration(duration)}），采集仅支持 {PROBE_MAX_DURATION_SEC // 60} 分钟内的短视频",
            )
        download_video_file(browser_meta["play_url"], browser_meta["referer"], video_path)
        meta = {
            "title": browser_meta.get("title") or "",
            "uploader": browser_meta.get("author") or "",
            "duration": duration,
            "thumbnail": "",
            "fetch_channel": "browser",
        }
        return meta, video_path

    def _download_video(self, url: str, target: Path) -> None:
        """yt-dlp 下载视频到目标路径。"""
        try:
            proc = _run_subprocess(
                [self._ytdlp_bin, "--no-playlist", "-f", "bv*+ba/b", "-o", str(target),
                 "--no-warnings", "--no-progress", "--max-filesize", str(MAX_FILE_SIZE_BYTES), url],
                timeout=300,
            )
        except subprocess.TimeoutExpired:
            raise VideoCollectError("VIDEOCLONE_LINK_UNAVAILABLE", "视频下载超时，请稍后重试或尝试较小视频")
        if proc.returncode != 0 or not target.exists():
            code, message = classify_download_error(proc.stderr)
            raise VideoCollectError(code, message)

    def _has_audio_stream(self, video_path: Path) -> bool:
        """ffprobe 检测是否含音频流。"""
        try:
            proc = _run_subprocess(
                [self._ffprobe_bin, "-v", "error", "-select_streams", "a",
                 "-show_entries", "stream=codec_type", "-of", "json", str(video_path)],
                timeout=30,
            )
            if proc.returncode != 0:
                return False
            data = json.loads(proc.stdout or "{}")
            return bool(data.get("streams"))
        except (subprocess.TimeoutExpired, json.JSONDecodeError):
            return False

    def _extract_audio(self, video_path: Path, audio_path: Path) -> None:
        """ffmpeg 提取 16kHz 单声道 PCM WAV。"""
        try:
            proc = _run_subprocess(
                [self._ffmpeg_bin, "-y", "-i", str(video_path),
                 "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(audio_path)],
                timeout=120,
            )
        except subprocess.TimeoutExpired:
            raise VideoCollectError("ASR_FAILED", "音频提取超时")
        if proc.returncode != 0 or not audio_path.exists():
            raise VideoCollectError("ASR_FAILED", f"音频提取失败: {(proc.stderr or '')[:200]}")

    def _transcribe_with_timeout(self, engine, audio_path: str):
        """带超时的转写（线程池执行 + future.result 超时）。

        注意：超时后底层转写线程无法被杀死（Python 线程特性），会继续运行至完成；
        单用户桌面应用场景下资源泄漏影响有限，Phase 2 改用进程级隔离。
        """
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(engine.transcribe, audio_path)
            try:
                return future.result(timeout=TRANSCRIBE_TIMEOUT_SEC)
            except FutureTimeoutError:
                raise asyncio.TimeoutError()


def _fmt_duration(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    return f"{m}:{s:02d}"
