# -*- coding: utf-8 -*-
"""T5 prerequisite: freeze the CURRENT Remotion-runtime dispatch behaviour.

The Remotion runtime has two live sub-paths in _render that the T5 switch must
reproduce byte-for-byte (DEV-PLAN 3.4 any-diff-revert):
  A) Remotion available + render fails -> governance 3-option downgrade BLOCKER,
     zero subprocess launched (RF-2: never silently fall back).
  B) Remotion unavailable (_needs_remotion False) -> FFmpeg _compose fallback,
     identical command sequence to the frozen ffmpeg golden.
This test PASSES against the un-switched _render; after T5 it must still pass
unchanged, which is the parity proof for the Remotion runtime.
"""
import json
from pathlib import Path

import pytest

from multi_publish.video_creation.base_tool import BaseTool, ToolResult
from multi_publish.video_creation.providers.video.video_compose import VideoCompose


def _normalize(argv, tmp_path):
    out = []
    for tok in argv:
        s = str(tok)
        if tmp_path and (str(tmp_path) in s):
            out.append("<TMP>/" + Path(s).name)
        else:
            out.append(s)
    return out


@pytest.fixture
def video_source(tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"0")
    return src


def _cut_inputs(tmp_path, src, n_cuts):
    cuts = [
        {"source": str(src), "in_seconds": 0.0, "out_seconds": 2.0},
        {"source": str(src), "in_seconds": 1.0, "out_seconds": 3.5},
    ][:n_cuts]
    return {
        "operation": "render",
        "output_path": str(tmp_path / "out" / "final.mp4"),
        "edit_decisions": {"render_runtime": "remotion", "cuts": cuts, "subtitles": {"enabled": False}},
        "asset_manifest": {"assets": [{"id": "a" + str(i), "path": str(src)} for i in range(n_cuts)]},
    }


def _patch_common(monkeypatch):
    monkeypatch.setattr(BaseTool, "run_command", lambda self, argv, *, timeout=None, cwd=None: None)
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(VideoCompose, "_has_audio_stream", staticmethod(lambda p: True))
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})

def test_remotion_downgrade_blocker_is_frozen(tmp_path, video_source, monkeypatch):
    captured = []

    def cap(argv, cwd, timeout):
        captured.append(list(argv))

    _patch_common(monkeypatch)
    monkeypatch.setattr(VideoCompose, "_needs_remotion", lambda self, cuts: True)
    monkeypatch.setattr(
        VideoCompose, "_remotion_render",
        lambda self, inputs: ToolResult(success=False, error="remotion engine boom"),
    )
    vc = VideoCompose()
    vc._cmd_capture = cap
    res = vc.execute(_cut_inputs(tmp_path, video_source, 2))
    assert res.success is False
    assert captured == [], "downgrade blocker must launch zero subprocess"
    got = res.error
    fixture = Path(__file__).parent / "fixtures" / "render_engine_baseline_remotion_blocker.txt"
    fixture.parent.mkdir(exist_ok=True)
    if not fixture.exists():
        fixture.write_text(got, encoding="utf-8")
    else:
        assert got == fixture.read_text(encoding="utf-8"), (
            "Remotion downgrade blocker drifted - T5 must keep it byte-identical")
    assert "renderer downgrade requires user approval" in got


def test_remotion_unavailable_falls_back_to_compose_golden(tmp_path, video_source, monkeypatch):
    captured = []

    def cap(argv, cwd, timeout):
        captured.append(list(argv))

    _patch_common(monkeypatch)
    monkeypatch.setattr(VideoCompose, "_needs_remotion", lambda self, cuts: False)
    vc = VideoCompose()
    vc._cmd_capture = cap
    res = vc.execute(_cut_inputs(tmp_path, video_source, 2))
    assert res.success is True, res.error
    ffmpeg_seqs = [a for a in captured if a and a[0] == "ffmpeg"]
    got = [_normalize(a, tmp_path) for a in ffmpeg_seqs]
    gp = Path(__file__).parent / "fixtures" / "render_engine_baseline_ffmpeg.json"
    assert got == json.loads(gp.read_text(encoding="utf-8")), (
        "Remotion-unavailable fallback must equal the frozen FFmpeg golden")
