# -*- coding: utf-8 -*-
"""T0b structural-equivalence baseline harness (ARCH-RENDER-ENGINE-ADAPTER A9/P2).

Uses the T0a capture seam (VideoCompose._cmd_capture) to freeze the logical
command sequences the current _render routing emits, so the later T2-T4
adapter migration can be proven command-equivalent by replaying these
baselines (DEV-PLAN 3.4: "any diff -> revert").
"""
import json
from pathlib import Path

import pytest

from multi_publish.video_creation.providers.video.video_compose import VideoCompose


def _normalize(cmd, tmp_path):
    out = []
    for tok in cmd:
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


def _ffmpeg_inputs(tmp_path, video_source, n_cuts=2):
    cuts = [
        {"source": str(video_source), "in_seconds": 0.0, "out_seconds": 2.0},
        {"source": str(video_source), "in_seconds": 1.0, "out_seconds": 3.5},
    ][:n_cuts]
    return {
        "operation": "render",
        "output_path": str(tmp_path / "out" / "final.mp4"),
        "edit_decisions": {
            "render_runtime": "ffmpeg",
            "cuts": cuts,
            "subtitles": {"enabled": False},
        },
        "asset_manifest": {"assets": [{"id": "a" + str(i + 1), "path": str(video_source)} for i in range(n_cuts)]},
    }


def _drive_ffmpeg(tmp_path, video_source, monkeypatch):
    captured = []

    def cap(cmd, cwd, timeout):
        captured.append(list(cmd))

    from multi_publish.video_creation.base_tool import BaseTool

    monkeypatch.setattr(BaseTool, "run_command", lambda self, cmd, *, timeout=None, cwd=None: None)
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(VideoCompose, "_has_audio_stream", staticmethod(lambda p: True))
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})

    vc = VideoCompose()
    vc._cmd_capture = cap
    inputs = _ffmpeg_inputs(tmp_path, video_source)
    res = vc.execute(inputs)
    return vc, inputs, captured, res


def test_ffmpeg_baseline_freezes_command_sequence(tmp_path, video_source, monkeypatch):
    vc, inputs, captured, res = _drive_ffmpeg(tmp_path, video_source, monkeypatch)
    assert res.success is True, res.error

    ffmpeg_cmds = [c for c in captured if c and c[0] == "ffmpeg"]
    for c in ffmpeg_cmds:
        assert isinstance(c, list)
        assert c[1] == "-y"
    assert any("-f" in c and "concat" in c for c in ffmpeg_cmds)
    assert Path(ffmpeg_cmds[-1][-1]).name == Path(inputs["output_path"]).name

    golden = [_normalize(c, tmp_path) for c in ffmpeg_cmds]
    fixture_dir = Path(__file__).parent / "fixtures"
    fixture_dir.mkdir(exist_ok=True)
    gp = fixture_dir / "render_engine_baseline_ffmpeg.json"
    if not gp.exists():
        gp.write_text(json.dumps(golden, indent=2, ensure_ascii=False), encoding="utf-8")
    else:
        assert json.loads(gp.read_text(encoding="utf-8")) == golden, (
            "FFmpeg render command baseline drifted - T2-T4 must be command-equivalent (revert switch).")


def test_seam_is_default_none_no_behavior_change():
    assert VideoCompose._cmd_capture is None
