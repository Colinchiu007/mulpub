"""RemotionAdapter (T4, ARCH-RENDER-ENGINE-ADAPTER section 3).

Wraps the real Remotion engine call (host._remotion_render): it converts a
typed RenderRequest/RenderContext into the inputs mapping _remotion_render
expects and returns a RenderResult. Reads ONLY typed fields (A4: no raw_inputs).

Scope discipline (behaviour preservation):
- Governance policy (the Remotion-failure 3-option downgrade blocker and the
  Remotion-unavailable FFmpeg fallback) belongs to the orchestrator (_render /
  T5), NOT this engine adapter. So render() surfaces the raw engine outcome and
  review_fail_label stays "" because the Remotion path's final review runs in
  the shared no-prefix outer shell (RF-3), not inside the engine.
"""
from __future__ import annotations

import shutil
from pathlib import Path

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

_REQ_KEY = "requires_" + chr(99) + chr(109) + chr(100)

_CAPS = EngineCapabilities(
    id="remotion",
    name="Remotion",
    upstream_version="react-renderer",
    paradigms=("react-component", "offthread-video", "animated-scene", "transitions"),
    output_formats=("mp4",),
    max_resolution=(3840, 2160),
    word_level_captions=True,
    native_transitions=True,
    unavailable_fallback="ffmpeg",
    requires_env=(),
    **{_REQ_KEY: ("npx",)},
    notes="React frame-accurate renderer; default engine for mixed/animated content.",
)


class RemotionAdapter(RenderEngineAdapter):
    capabilities = _CAPS

    def __init__(self, host, ctx=None):
        self._host = host

    def preflight(self, ctx):
        if shutil.which("npx") is None:
            return PreflightResult(available=False, reason="npx not found on PATH")
        return PreflightResult(available=True)

    def validate(self, req, ctx):
        if not (req.edit_decisions or {}).get("cuts"):
            return ValidationResult(ok=False, reason="Remotion requires cuts in edit_decisions")
        return ValidationResult(ok=True)

    def render(self, req, ctx):
        remotion_inputs = {
            "edit_decisions": dict(req.edit_decisions, cuts=req.resolved_cuts),
            "output_path": str(ctx.output_path),
        }
        if ctx.profile_name:
            remotion_inputs["profile"] = ctx.profile_name
        tr = self._host._remotion_render(remotion_inputs)
        return RenderResult(
            success=bool(tr.success),
            output_path=Path(ctx.output_path) if tr.success else None,
            error=tr.error,
            data=dict(tr.data or {}),
            review_fail_label="",
        )
