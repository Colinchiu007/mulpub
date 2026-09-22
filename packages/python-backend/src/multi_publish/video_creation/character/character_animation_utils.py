"""Character animation utility functions.

Extracted from character_animation.py to reduce file size.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Any


def _write_json(path: str | None, data: dict[str, Any]) -> list[str]:
    if not path:
        return []
    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return [str(out)]


def _slug(value: str) -> str:
    chars = [c.lower() if c.isalnum() else "-" for c in value.strip()]
    return "-".join("".join(chars).split("-")).strip("-") or "character"


def _character_color(index: int) -> tuple[str, str]:
    palettes = [
        ("#ff8f68", "#ffd39f"),
        ("#75b8ff", "#ffe7a3"),
        ("#8fd17f", "#f7c8ff"),
        ("#f2c94c", "#fce6c9"),
    ]
    return palettes[index % len(palettes)]


def _normalize_style(style: Any) -> dict[str, Any]:
    if not isinstance(style, dict):
        return {}
    normalized: dict[str, Any] = {}
    visual_style = style.get("visual_style") or style.get("name") or style.get("style")
    if visual_style:
        normalized["visual_style"] = str(visual_style)
    palette = style.get("palette")
    if isinstance(palette, list):
        normalized["palette"] = [str(color) for color in palette]
    for key in ["line_style", "texture"]:
        if style.get(key):
            normalized[key] = str(style[key])
    return normalized


def _render_preview_mp4(preview_path: Path, video_path: Path, duration_seconds: float, fps: int) -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg is required to render preview MP4")
    try:
        from playwright.sync_api import sync_playwright
    except Exception as exc:  # pragma: no cover - dependency-specific branch
        raise RuntimeError("Playwright is required to render preview MP4") from exc

    frame_dir = video_path.parent / f"{video_path.stem}_frames"
    frame_dir.mkdir(parents=True, exist_ok=True)
    frame_count = max(2, int(duration_seconds * fps))
    with sync_playwright() as p:
        browser = p.chromium.launch()
        # P1-12: goto/screenshot 任一帧抛异常都会跳过 browser.close()，
        # 每次失败泄漏一个 Chromium 进程组（长时间跑批 → 内存/句柄耗尽）。
        # 与 browser_fetcher.py 保持一致：launch 之后一律 try/finally 关闭。
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            page.goto(preview_path.resolve().as_uri(), wait_until="networkidle")
            for frame in range(frame_count):
                if frame:
                    page.wait_for_timeout(int(1000 / fps))
                page.screenshot(path=str(frame_dir / f"frame_{frame:04d}.png"))
        finally:
            browser.close()

    cmd = [
        "ffmpeg",
        "-y",
        "-framerate",
        str(fps),
        "-i",
        str(frame_dir / "frame_%04d.png"),
        "-r",
        str(fps),
        "-pix_fmt",
        "yuv420p",
        str(video_path),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or "ffmpeg failed to render preview MP4")
