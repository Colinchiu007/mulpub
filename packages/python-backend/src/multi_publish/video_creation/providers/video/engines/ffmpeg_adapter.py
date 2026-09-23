"""FFmpegAdapter (T3, ARCH-RENDER-ENGINE-ADAPTER section 3).

render() wraps host._render_via_ffmpeg (T5) so the full compose + final-review
path stays byte-identical; build_compose_inputs() remains as the T3 typed
equivalence helper proving the compose argv grammar is unchanged.
inline and delegates to host._compose (single source of FFmpeg command grammar).
Reads ONLY typed RenderContext/RenderRequest fields (A4: no raw_inputs).
"""
from __future__ import annotations

import shutil
from pathlib import Path
from typing import TYPE_CHECKING

from multi_publish.video_creation.providers.video.engines.base import (
    RenderEngineAdapter,
)
from multi_publish.video_creation.providers.video.engines.capabilities import (
    EngineCapabilities,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
    RenderResult,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    ValidationResult,
)

if TYPE_CHECKING:
    from multi_publish.video_creation.providers.video.video_compose import (
        VideoCompose,
    )

_CAPS = EngineCapabilities(
    id="ffmpeg",
    name="FFmpeg",
    upstream_version="external",
    paradigms=("trim", "concat", "subtitle_burn", "audio_mux"),
    output_formats=("mp4",),
    max_resolution=(7680, 4320),
    word_level_captions=False,
    native_transitions=False,
    unavailable_fallback=None,
    requires_cmd=("ffmpeg",),
    requires_env=(),
    notes="Video-only concat/trim engine.",
)

class FFmpegAdapter(RenderEngineAdapter):
    capabilities = _CAPS

    def __init__(self, host, ctx=None):
        self._host = host

    def preflight(self, ctx):
        if shutil.which("ffmpeg") is None:
            return PreflightResult(available=False, reason="ffmpeg binary not found on PATH")
        return PreflightResult(available=True)

    def validate(self, req, ctx):
        if not req.resolved_cuts:
            return ValidationResult(ok=False, reason="No cuts resolved for FFmpeg compose")
        return ValidationResult(ok=True)

    def build_compose_inputs(self, req, ctx):
        options = dict(ctx.options or {})
        subtitle_burn = options.get("subtitle_burn", True)
        subtitle_path = ctx.subtitle_path
        if subtitle_burn and not subtitle_path:
            ed_subs = (req.edit_decisions or {}).get("subtitles", {}) or {}
            if ed_subs.get("enabled") and ed_subs.get("source"):
                subtitle_path = ed_subs["source"]

        compose_inputs = {
            "edit_decisions": dict(req.edit_decisions, cuts=req.resolved_cuts),
            "output_path": str(ctx.output_path),
            "codec": ctx.codec,
            "crf": ctx.crf,
            "preset": ctx.preset,
        }
        if ctx.audio_path:
            compose_inputs["audio_path"] = ctx.audio_path
        if subtitle_path:
            compose_inputs["subtitle_path"] = subtitle_path
        if ctx.profile_name:
            compose_inputs["profile"] = ctx.profile_name
        if ctx.subtitle_style:
            compose_inputs["subtitle_style"] = ctx.subtitle_style
        if ctx.playbook:
            compose_inputs["playbook"] = ctx.playbook
        if options:
            compose_inputs["options"] = options
        return compose_inputs

    def render(self, req, ctx):
        # T5: wrap the full host._render_via_ffmpeg path (compose + '(FFmpeg)'
        # final review) so the thin _render returns a byte-identical ToolResult.
        tr = self._host._render_via_ffmpeg(
            inputs=ctx.raw_inputs,
            edit_decisions=req.edit_decisions,
            resolved_cuts=req.resolved_cuts,
            output_path=ctx.output_path,
            profile=ctx.profile_name,
        )
        return RenderResult(
            success=bool(tr.success),
            output_path=Path(ctx.output_path) if tr.success else None,
            error=tr.error,
            data=dict(tr.data or {}),
            artifacts=list(tr.artifacts or []),
            review_fail_label="(FFmpeg)",
            tool_result=tr,
        )
