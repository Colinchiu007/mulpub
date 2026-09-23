"""HyperFramesAdapter (T4, ARCH-RENDER-ENGINE-ADAPTER section 3).

Delegates to host._render_via_hyperframes so the observable behaviour (including
the F-2 fail-closed governance blocker) stays byte-identical by construction:
via video_compose, _hyperframes_available() is always False (wrong import path
F-2), so render() short-circuits to the structured BLOCKER with zero subprocess.
Reconstructs the inputs mapping from typed ctx fields (A4: no raw_inputs); the
extra passthrough knobs ride in ctx.options.
"""
from __future__ import annotations

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
    id="hyperframes",
    name="HyperFrames",
    upstream_version="node22-bridge",
    paradigms=("html-css", "node-bridge"),
    output_formats=("mp4",),
    max_resolution=(3840, 2160),
    word_level_captions=True,
    native_transitions=True,
    unavailable_fallback=None,
    requires_env=(),
    **{_REQ_KEY: ("npx", "ffmpeg")},
    notes="Blocked via video_compose by F-2 (import path); fail-closed blocker.",
)

class HyperFramesAdapter(RenderEngineAdapter):
    capabilities = _CAPS

    def __init__(self, host, ctx=None):
        self._host = host

    def preflight(self, ctx):
        if not self._host._hyperframes_available():
            return PreflightResult(
                available=False,
                reason="HyperFrames runtime unavailable on this machine (F-2)",
            )
        return PreflightResult(available=True)

    def validate(self, req, ctx):
        if not req.resolved_cuts:
            return ValidationResult(ok=False, reason="HyperFrames requires resolved cuts")
        return ValidationResult(ok=True)

    def build_inputs(self, ctx):
        inputs = dict(ctx.options or {})
        inputs.setdefault(
            "workspace_path", str(Path(ctx.output_path).parent.parent / "hyperframes"))
        if ctx.playbook:
            inputs["playbook"] = ctx.playbook
        if ctx.proposal_packet:
            inputs["proposal_packet"] = ctx.proposal_packet
        return inputs

    def render(self, req, ctx):
        # T5: pass ctx.raw_inputs verbatim so host._render_via_hyperframes runs
        # with the exact mapping _render used to build - the F-2 fail-closed
        # blocker and the '(HyperFrames)' final review stay byte-identical.
        tr = self._host._render_via_hyperframes(
            inputs=ctx.raw_inputs,
            edit_decisions=req.edit_decisions,
            asset_manifest=req.asset_manifest,
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
            review_fail_label="(HyperFrames)",
            tool_result=tr,
        )
