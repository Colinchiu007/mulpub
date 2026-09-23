"""T5 prerequisite: freeze the FULL ToolResult return-shape (not just commands).

The command baselines prove argv equivalence but a naive _render->adapter switch
could still silently drop ToolResult.data keys or artifacts. These shape
baselines lock the externally-visible result contract for the render success
paths, so T5 parity is asserted on the final ToolResult, not only subprocesses.
"""
from pathlib import Path

import pytest

from multi_publish.video_creation.base_tool import BaseTool, ToolResult
from multi_publish.video_creation.providers.video.video_compose import VideoCompose


@pytest.fixture
def video_source(tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"0")
    return src


def _drive(tmp_path, src, runtime, monkeypatch):
    def _rc(self, argv, *, timeout=None, cwd=None):
        try:
            out = Path(str(argv[-1]))
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(b"0")
        except Exception:
            pass
        return None

    monkeypatch.setattr(BaseTool, "run_command", _rc)
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(VideoCompose, "_has_audio_stream", staticmethod(lambda p: True))
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})
    if runtime == "remotion":
        monkeypatch.setattr(VideoCompose, "_needs_remotion", lambda self, cuts: False)
    cuts = [
        {"source": str(src), "in_seconds": 0.0, "out_seconds": 2.0},
        {"source": str(src), "in_seconds": 1.0, "out_seconds": 3.5},
    ]
    inputs = {
        "operation": "render",
        "output_path": str(tmp_path / "out" / "final.mp4"),
        "edit_decisions": {"render_runtime": runtime, "cuts": cuts, "subtitles": {"enabled": False}},
        "asset_manifest": {"assets": [{"id": "a" + str(i), "path": str(src)} for i in range(2)]},
    }
    return VideoCompose().execute(inputs)


def test_render_success_shape_is_frozen(tmp_path, video_source, monkeypatch):
    res = _drive(tmp_path, video_source, "ffmpeg", monkeypatch)
    assert res.success is True, res.error
    d = res.data
    assert d["operation"] == "compose"
    assert d["cut_count"] == 2
    assert d["has_subtitles"] is False
    assert d["has_mixed_audio"] is False
    assert d["profile"] is None
    assert d["final_review_status"] == "pass"
    assert "final_review" in d
    assert Path(d["output"]).name == "final.mp4"
    assert res.artifacts == [str(Path(tmp_path) / "out" / "final.mp4")]


def test_render_remotion_success_shape_is_frozen(tmp_path, video_source, monkeypatch):
    """Remotion-available success: freeze the full ToolResult the thin _render
    must return after the T5 registry switch (operation remotion_render + merged
    final_review + artifacts passthrough), distinct from the compose shape."""
    out = tmp_path / "out" / "final.mp4"

    def _rc(self, argv, *, timeout=None, cwd=None):
        try:
            o = Path(str(argv[-1])); o.parent.mkdir(parents=True, exist_ok=True); o.write_bytes(b"0")
        except Exception:
            pass
        return None

    monkeypatch.setattr(BaseTool, "run_command", _rc)
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_needs_remotion", lambda self, cuts: True)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})

    def fake_rr(self, inputs):
        Path(str(inputs["output_path"])).parent.mkdir(parents=True, exist_ok=True)
        Path(str(inputs["output_path"])).write_bytes(b"0")
        return ToolResult(success=True, data={"operation": "remotion_render", "output": str(inputs["output_path"]), "profile": None}, artifacts=[str(inputs["output_path"])])

    monkeypatch.setattr(VideoCompose, "_remotion_render", fake_rr)
    cuts = [{"source": str(video_source), "in_seconds": 0.0, "out_seconds": 2.0}]
    inputs = {
        "operation": "render",
        "output_path": str(out),
        "edit_decisions": {"render_runtime": "remotion", "cuts": cuts, "subtitles": {"enabled": False}},
        "asset_manifest": {"assets": [{"id": "a0", "path": str(video_source)}]},
    }
    res = VideoCompose().execute(inputs)
    assert res.success is True, res.error
    d = res.data
    assert d["operation"] == "remotion_render"
    assert d["final_review_status"] == "pass"
    assert "final_review" in d
    assert Path(d["output"]).name == "final.mp4"
    assert res.artifacts == [str(out)]
