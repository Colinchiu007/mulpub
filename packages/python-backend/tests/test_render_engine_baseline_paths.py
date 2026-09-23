# -*- coding: utf-8 -*-
"""T0b baseline harness - additional command-shape + governance invariants.

Complements test_render_engine_baseline.py (canonical ffmpeg sequence). These
baselines freeze the FFmpeg filter variants and the governance / F-2 no-op
contract that T2-T4 adapters and the T5 _render switch must reproduce exactly
(DEV-PLAN 3.4: any diff -> revert).
"""
from pathlib import Path

import pytest

from multi_publish.video_creation.providers.video.video_compose import VideoCompose
from multi_publish.video_creation.base_tool import BaseTool


def _mk_source(tmp_path):
    src = tmp_path / "clip.mp4"
    src.write_bytes(b"0")
    return src


def _inputs(tmp_path, src, render_runtime="ffmpeg", extra_ed=None, n_cuts=1):
    cuts = [{"source": str(src), "in_seconds": 0.0, "out_seconds": 2.0} for _ in range(n_cuts)]
    ed = {"render_runtime": render_runtime, "cuts": cuts, "subtitles": {"enabled": False}}
    if extra_ed:
        ed.update(extra_ed)
    return {
        "operation": "render",
        "output_path": str(tmp_path / "out" / "final.mp4"),
        "edit_decisions": ed,
        "asset_manifest": {"assets": [{"id": "a0", "path": str(src)}]},
    }


def _drive(tmp_path, src, inputs, monkeypatch, has_audio=True):
    captured = []

    def cap(cmd, cwd, timeout):
        captured.append(list(cmd))

    monkeypatch.setattr(BaseTool, "run_command", lambda self, cmd, *, timeout=None, cwd=None: None)
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(VideoCompose, "_has_audio_stream", staticmethod(lambda p: has_audio))
    monkeypatch.setattr(VideoCompose, "_pre_compose_validation", lambda self, ed, rc, sp: None)
    monkeypatch.setattr(VideoCompose, "_run_final_review", lambda self, *a, **k: {"status": "pass", "issues_found": []})
    vc = VideoCompose()
    vc._cmd_capture = cap
    res = vc.execute(inputs)
    return captured, res


def test_ffmpeg_subtitle_burn_command_shape(tmp_path, monkeypatch):
    src = _mk_source(tmp_path)
    sub = tmp_path / "subs.ass"
    sub.write_text("[Events]", encoding="utf-8")
    inputs = _inputs(tmp_path, src, extra_ed={"subtitles": {"enabled": True, "source": str(sub)}})
    captured, res = _drive(tmp_path, src, inputs, monkeypatch)
    ffmpeg_cmds = [c for c in captured if c and c[0] == "ffmpeg"]
    assert res.success is True, res.error
    joined = " ".join(" ".join(c) for c in ffmpeg_cmds)
    assert "subtitles=" in joined
    assert "force_style" in joined


def test_ffmpeg_no_audio_injects_silent_lavfi(tmp_path, monkeypatch):
    src = _mk_source(tmp_path)
    inputs = _inputs(tmp_path, src)
    captured, res = _drive(tmp_path, src, inputs, monkeypatch, has_audio=False)
    ffmpeg_cmds = [c for c in captured if c and c[0] == "ffmpeg"]
    assert res.success is True, res.error
    joined = " ".join(" ".join(c) for c in ffmpeg_cmds)
    assert "anullsrc" in joined
    assert "lavfi" in joined


def test_ffmpeg_speed_change_adds_setpts_atempo(tmp_path, monkeypatch):
    src = _mk_source(tmp_path)
    inputs = _inputs(tmp_path, src)
    inputs["edit_decisions"]["cuts"][0]["speed"] = 1.5
    captured, res = _drive(tmp_path, src, inputs, monkeypatch)
    ffmpeg_cmds = [c for c in captured if c and c[0] == "ffmpeg"]
    assert res.success is True, res.error
    joined = " ".join(" ".join(c) for c in ffmpeg_cmds)
    assert "setpts=" in joined
    assert "atempo" in joined


def test_hyperframes_f2_yields_blocker_and_zero_commands(tmp_path, monkeypatch):
    # F-2: via video_compose, _hyperframes_available() is always False, so
    # render_runtime='hyperframes' short-circuits to a governance BLOCKER with
    # NO subprocess launched. Frozen baseline: the adapter switch must keep this
    # an empty-command fail-closed blocker until F-2 is separately fixed.
    src = _mk_source(tmp_path)
    inputs = _inputs(tmp_path, src, render_runtime="hyperframes")
    captured, res = _drive(tmp_path, src, inputs, monkeypatch)
    assert res.success is False
    assert "not available" in res.error or "BLOCKER" in res.error
    assert captured == []


def test_governance_empty_and_unknown_runtime_launch_nothing(tmp_path, monkeypatch):
    src = _mk_source(tmp_path)
    for bad in ["", "   ", "quantum"]:
        inputs = _inputs(tmp_path, src, render_runtime=bad)
        captured, res = _drive(tmp_path, src, inputs, monkeypatch)
        assert res.success is False
        assert captured == [], "governance early-return must launch zero commands"
