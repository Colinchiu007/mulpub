"""T4 Remotion/HyperFrames adapter equivalence gates (ARCH A9 / DEV-PLAN 3.4).

RemotionAdapter: renders by delegating the raw engine call (host._remotion_render)
with an inputs mapping rebuilt from typed fields; governance wrapping and final
review belong to the orchestrator (T5), so review_fail_label stays "".

HyperFramesAdapter: delegates to host._render_via_hyperframes, so the F-2
fail-closed blocker is byte-identical to the current _render runtime dispatch and
launches zero subprocesses.
"""

import pytest

from multi_publish.video_creation.base_tool import BaseTool, ToolResult
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
)
from multi_publish.video_creation.providers.video.engines.hyperframes_adapter import (
    HyperFramesAdapter,
)
from multi_publish.video_creation.providers.video.engines.remotion_adapter import (
    RemotionAdapter,
)
from multi_publish.video_creation.providers.video.video_compose import VideoCompose


@pytest.fixture
def video_source(tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"0")
    return src


def _ctx(tmp_path, **kw):
    base = dict(
        output_path=tmp_path / "out" / "final.mp4",
        profile=None,
        asset_lookup={},
        proposal_packet=None,
    )
    base.update(kw)
    return RenderContext(**base)


def _req(cuts, **ed_extra):
    ed = {"render_runtime": "remotion", "cuts": cuts, "subtitles": {"enabled": False}}
    ed.update(ed_extra)
    return RenderRequest(edit_decisions=ed, resolved_cuts=[dict(c) for c in cuts], asset_manifest={"assets": []})

def test_remotion_adapter_delegates_to_full_render_via_remotion_path(tmp_path, monkeypatch):
    # T5: the adapter wraps host._render_via_remotion (needs_remotion routing +
    # RF-2 downgrade + FFmpeg fallback + final review) and carries its ToolResult.
    seen = {}
    sentinel = ToolResult(
        success=True, data={"operation": "remotion_render"}, artifacts=["out/final.mp4"]
    )

    def fake_rvr(self, *, inputs, edit_decisions, resolved_cuts, output_path, profile):
        seen["inputs"] = inputs
        seen["resolved_cuts"] = resolved_cuts
        seen["output_path"] = output_path
        seen["profile"] = profile
        return sentinel

    monkeypatch.setattr(VideoCompose, "_render_via_remotion", fake_rvr)
    cuts = [{"source": "x.mp4", "in_seconds": 0.0, "out_seconds": 1.0}]
    ctx = _ctx(tmp_path, profile_name="vertical", raw_inputs={"operation": "render"})
    req = _req(cuts)
    res = RemotionAdapter(VideoCompose()).render(req, ctx)
    assert res.success is True
    assert res.review_fail_label == ""
    assert res.tool_result is sentinel
    assert res.artifacts == ["out/final.mp4"]
    assert seen["profile"] == "vertical"
    assert seen["output_path"] == ctx.output_path
    assert seen["resolved_cuts"] == req.resolved_cuts
    assert seen["inputs"] == {"operation": "render"}


def test_remotion_adapter_preserves_downgrade_blocker_through_full_path(tmp_path, monkeypatch):
    # RF-2: Remotion available + render fails must still surface the governance
    # downgrade BLOCKER (empty label) after the T5 registry switch.
    monkeypatch.setattr(VideoCompose, "_needs_remotion", lambda self, cuts: True)
    monkeypatch.setattr(
        VideoCompose, "_remotion_render",
        lambda self, inputs: ToolResult(success=False, error="engine boom"),
    )
    cuts = [{"source": "x.mp4", "in_seconds": 0.0, "out_seconds": 1.0}]
    ctx = _ctx(tmp_path, raw_inputs={})
    res = RemotionAdapter(VideoCompose()).render(_req(cuts), ctx)
    assert res.success is False
    assert res.review_fail_label == ""
    assert "renderer downgrade requires user approval" in res.error
    assert res.tool_result is not None


def _drive_render(tmp_path, src, runtime, monkeypatch):
    captured = []

    def cap(argv, cwd, timeout):
        captured.append(list(argv))

    monkeypatch.setattr(BaseTool, "run_command", lambda self, argv, *, timeout=None, cwd=None: None)
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(VideoCompose, "_has_audio_stream", staticmethod(lambda p: True))
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})
    vc = VideoCompose()
    vc._cmd_capture = cap
    cuts = [{"source": str(src), "in_seconds": 0.0, "out_seconds": 2.0}]
    inputs = {
        "operation": "render",
        "output_path": str(tmp_path / "out" / "final.mp4"),
        "edit_decisions": {"render_runtime": runtime, "cuts": cuts, "subtitles": {"enabled": False}},
        "asset_manifest": {"assets": [{"id": "a0", "path": str(src)}]},
    }
    res = vc.execute(inputs)
    return vc, captured, res, cuts


def test_hyperframes_adapter_matches_render_dispatch_blocker(tmp_path, video_source, monkeypatch):
    vc, captured, res, cuts = _drive_render(tmp_path, video_source, "hyperframes", monkeypatch)
    assert res.success is False
    assert captured == []
    ctx = _ctx(tmp_path)
    req = RenderRequest(edit_decisions={"render_runtime": "hyperframes", "cuts": cuts, "subtitles": {"enabled": False}}, resolved_cuts=[dict(c) for c in cuts], asset_manifest={"assets": []})
    hf = HyperFramesAdapter(VideoCompose())
    got = hf.render(req, ctx)
    assert got.success is False
    assert got.error == res.error, "HyperFramesAdapter must reproduce the current blocker byte-for-byte"
