# -*- coding: utf-8 -*-
"""T4 Remotion/HyperFrames adapter equivalence gates (ARCH A9 / DEV-PLAN 3.4).

RemotionAdapter: renders by delegating the raw engine call (host._remotion_render)
with an inputs mapping rebuilt from typed fields; governance wrapping and final
review belong to the orchestrator (T5), so review_fail_label stays "".

HyperFramesAdapter: delegates to host._render_via_hyperframes, so the F-2
fail-closed blocker is byte-identical to the current _render runtime dispatch and
launches zero subprocesses.
"""
from pathlib import Path

import pytest

from multi_publish.video_creation.base_tool import BaseTool, ToolResult
from multi_publish.video_creation.providers.video.video_compose import VideoCompose
from multi_publish.video_creation.providers.video.engines.remotion_adapter import (
    RemotionAdapter,
)
from multi_publish.video_creation.providers.video.engines.hyperframes_adapter import (
    HyperFramesAdapter,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
)


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

def test_remotion_adapter_delegates_engine_call_with_typed_inputs(tmp_path, monkeypatch):
    seen = {}

    def fake_rr(self, inputs):
        seen.update(inputs)
        return ToolResult(success=True, data={"operation": "remotion_render"}, artifacts=[])

    monkeypatch.setattr(VideoCompose, "_remotion_render", fake_rr)
    cuts = [{"source": "x.mp4", "in_seconds": 0.0, "out_seconds": 1.0}]
    ctx = _ctx(tmp_path, profile_name="vertical")
    req = _req(cuts)
    res = RemotionAdapter(VideoCompose()).render(req, ctx)
    assert res.success is True
    assert res.review_fail_label == ""
    assert seen["output_path"] == str(ctx.output_path)
    assert seen["edit_decisions"]["cuts"] == req.resolved_cuts
    assert seen["profile"] == "vertical"


def test_remotion_adapter_surfaces_raw_failure_with_empty_label(tmp_path, monkeypatch):
    def fake_rr(self, inputs):
        return ToolResult(success=False, error="npx not found. Install Node.js to use Remotion rendering.")

    monkeypatch.setattr(VideoCompose, "_remotion_render", fake_rr)
    cuts = [{"source": "x.mp4", "in_seconds": 0.0, "out_seconds": 1.0}]
    res = RemotionAdapter(VideoCompose()).render(_req(cuts), _ctx(tmp_path))
    assert res.success is False
    assert res.error == "npx not found. Install Node.js to use Remotion rendering."
    assert res.review_fail_label == ""


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
