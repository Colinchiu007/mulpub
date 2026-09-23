# -*- coding: utf-8 -*-
"""audio-aligner API 契约测试（mock transcribe，不依赖真实音频/模型）。"""
import logging
import pytest
from fastapi.testclient import TestClient

from aligner import api as api_mod


@pytest.fixture()
def client(monkeypatch):
    return TestClient(api_mod.app)


@pytest.fixture()
def aligner_root(tmp_path, monkeypatch):
    """P2 路径约束后 /align 只接受允许目录内的真实文件，本测试独占 tmp_path 作为根。"""
    monkeypatch.setenv("AUDIO_ALIGNER_ALLOWED_DIRS", str(tmp_path))
    return tmp_path


@pytest.fixture()
def aligner_audio(aligner_root):
    f = aligner_root / "vo.mp3"
    f.write_bytes(b"fake-audio")
    return str(f)


@pytest.fixture()
def aligner_missing(aligner_root):
    return str(aligner_root / "not-exist.mp3")


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_align_success(client, monkeypatch, aligner_audio):
    def fake_transcribe(audio_path, **kwargs):
        return {
            "words": [{"text": "你好", "start": 0.0, "end": 0.5, "probability": 0.99}],
            "segments": [{"text": "你好", "start": 0.0, "end": 0.5}],
            "language": "zh",
            "language_probability": 0.98,
            "duration": 0.5,
            "elapsed_ms": 320,
            "model": "base",
        }

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    r = client.post("/align", json={"audio_path": aligner_audio, "options": {"model": "base", "language": "zh"}})
    assert r.status_code == 200
    body = r.json()
    assert body["words"][0]["text"] == "你好"
    assert body["duration"] == 0.5


def test_align_missing_audio(client, monkeypatch, aligner_missing):
    def fake_transcribe(audio_path, **kwargs):
        raise FileNotFoundError(audio_path)

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    r = client.post("/align", json={"audio_path": aligner_missing})
    assert r.status_code == 404


def test_align_logs_request_id_success(client, monkeypatch, caplog, aligner_audio):
    """R4：成功路径日志含 request_id（跨进程 traceId）。"""

    def fake_transcribe(audio_path, **kwargs):
        return {"words": [{"text": "a", "start": 0.0, "end": 0.5}], "segments": [], "language": "zh", "duration": 0.5, "elapsed_ms": 10, "model": "base"}

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    with caplog.at_level(logging.INFO):
        r = client.post("/align", json={"audio_path": aligner_audio}, headers={"X-Request-Id": "run_123"})
    assert r.status_code == 200
    assert any("request_id=run_123" in rec.getMessage() for rec in caplog.records)


def test_align_logs_request_id_error(client, monkeypatch, caplog, aligner_audio):
    """R4：异常路径日志同样含 request_id。"""

    def fake_transcribe(audio_path, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    with caplog.at_level(logging.ERROR):
        r = client.post("/align", json={"audio_path": aligner_audio}, headers={"X-Request-Id": "run_456"})
    assert r.status_code == 500
    assert any("request_id=run_456" in rec.getMessage() for rec in caplog.records)


def test_align_transcribe_error(client, monkeypatch, aligner_audio):
    def fake_transcribe(audio_path, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    r = client.post("/align", json={"audio_path": aligner_audio})
    assert r.status_code == 500
    assert "boom" in r.json()["detail"]


class TestSilenceSnap:
    def test_snap_function_word_after_pause(self):
        from aligner.core import snap_words_to_silence
        words = [
            {"text": "料", "start": 4.20, "end": 4.40},
            {"text": "那", "start": 4.40, "end": 4.90},  # 起点落在停顿内 → 吸附到 4.82
            {"text": "可", "start": 4.90, "end": 5.06},
        ]
        snaps = [(4.51, 4.82)]
        out = snap_words_to_silence(words, snaps)
        assert out[1]["start"] == 4.82
        assert out[0]["start"] == 4.20  # 停顿外的词不变
        assert words[1]["start"] == 4.40  # 不修改入参

    def test_snap_small_drift_and_no_overlap(self):
        from aligner.core import snap_words_to_silence
        words = [
            {"text": "盐", "start": 3.38, "end": 3.64},
            {"text": "巴", "start": 3.64, "end": 3.84},
        ]
        snaps = [(2.94, 3.52)]
        out = snap_words_to_silence(words, snaps)
        assert out[0]["start"] == 3.52
        assert out[1]["start"] == 3.64

    def test_detect_silences_parse(self):
        from aligner.core import detect_silences
        # 用 mock subprocess 返回 ffmpeg 文本
        class FakeProc:
            stderr = (
                "[silencedetect] silence_start: 1.92983\n"
                "[silencedetect] silence_end: 2.38233 | silence_duration: 0.4525\n"
            )
        import aligner.core as core
        orig = core.subprocess.run
        core.subprocess.run = lambda *a, **k: FakeProc()
        try:
            intervals = detect_silences("x.mp3", ffmpeg_path="ffmpeg")
        finally:
            core.subprocess.run = orig
        assert intervals == [(1.92983, 2.38233)]
