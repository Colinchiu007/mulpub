# -*- coding: utf-8 -*-
"""T3 FFmpegAdapter command-equivalence gate (ARCH A9 / DEV-PLAN 3.4).

Proves the real adapter emits a byte-identical FFmpeg argv sequence to the T0b
frozen golden by routing the SAME scenario through FFmpegAdapter.render() and
replaying against render_engine_baseline_ffmpeg.json. A4: compose_inputs is
built from typed RenderContext fields only (raw_inputs untouched).
"""
import json
from pathlib import Path

import pytest

from multi_publish.video_creation.base_tool import BaseTool
from multi_publish.video_creation.providers.video.video_compose import VideoCompose
from multi_publish.video_creation.providers.video.engines.ffmpeg_adapter import (
    FFmpegAdapter,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
)


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


def _scenario(tmp_path, video_source):
    cuts = [
        {"source": str(video_source), "in_seconds": 0.0, "out_seconds": 2.0},
        {"source": str(video_source), "in_seconds": 1.0, "out_seconds": 3.5},
    ]
    edit_decisions = {
        "render_runtime": "ffmpeg",
        "cuts": cuts,
        "subtitles": {"enabled": False},
    }
    out = tmp_path / "out" / "final.mp4"
    ctx = RenderContext(
        output_path=out,
        profile=None,
        asset_lookup={},
        proposal_packet=None,
        codec="libx264",
        crf=23,
        preset="medium",
    )
    req = RenderRequest(
        edit_decisions=edit_decisions,
        resolved_cuts=[dict(c) for c in cuts],
        asset_manifest={"assets": []},
    )
    return ctx, req

def test_adapter_matches_frozen_ffmpeg_baseline(tmp_path, video_source, monkeypatch):
    captured = []

    def cap(argv, cwd, timeout):
        captured.append(list(argv))

    monkeypatch.setattr(
        BaseTool, "run_command",
        lambda self, argv, *, timeout=None, cwd=None: None,
    )
    monkeypatch.setattr(VideoCompose, "_is_image", staticmethod(lambda p: False))
    monkeypatch.setattr(
        VideoCompose, "_has_audio_stream", staticmethod(lambda p: True))

    vc = VideoCompose()
    vc._cmd_capture = cap
    ctx, req = _scenario(tmp_path, video_source)
    result = FFmpegAdapter(vc).render(req, ctx)
    assert result.success is True, result.error
    assert result.review_fail_label == "(FFmpeg)"

    seqs = [a for a in captured if a and a[0] == "ffmpeg"]
    got = [_normalize(a, tmp_path) for a in seqs]

    gp = Path(__file__).parent / "fixtures" / "render_engine_baseline_ffmpeg.json"
    golden = json.loads(gp.read_text(encoding="utf-8"))
    assert got == golden, (
        "FFmpegAdapter diverged from the frozen T0b baseline - revert switch.")
