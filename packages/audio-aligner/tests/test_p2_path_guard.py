# -*- coding: utf-8 -*-
"""P2 安全小项回归：audio-aligner `audio_path` 目录约束（体检报告 §安全小项）。

覆盖两层：
1. ``aligner.path_guard`` 纯逻辑（绝对路径 / 前缀陷阱 / 符号链接 / 存在性判定顺序）；
2. ``POST /align`` 的 HTTP 语义（400 / 403 / 404，且越权路径不得触达 transcribe）。
"""
import json
import os
import sys
import tempfile

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from aligner import api as api_mod  # noqa: E402
from aligner import path_guard  # noqa: E402


# --------------------------------------------------------------------------
# path_guard 纯逻辑
# --------------------------------------------------------------------------

def test_relative_path_is_invalid(tmp_path):
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path("vo.mp3", roots=[str(tmp_path)])
    assert exc.value.code == path_guard.INVALID_PATH
    assert exc.value.status_code == 400


@pytest.mark.parametrize("bad", ["", "   ", "\x00vo.mp3"])
def test_blank_and_nul_path_is_invalid(bad, tmp_path):
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(bad, roots=[str(tmp_path)])
    assert exc.value.code == path_guard.INVALID_PATH


def test_sibling_prefix_is_not_inside(tmp_path):
    """兄弟目录前缀陷阱：allowed=/x/dist，路径 /x/dist-evil/vo.mp3 必须判越权。"""
    root = tmp_path / "dist"
    root.mkdir()
    outside = tmp_path / "dist-evil"
    outside.mkdir()
    f = outside / "vo.mp3"
    f.write_bytes(b"x")
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(str(f), roots=[str(root)])
    assert exc.value.code == path_guard.NOT_ALLOWED
    assert exc.value.status_code == 403


def test_traversal_within_root_cannot_escape(tmp_path):
    """root 内用 `..` 拼出外部文件：realpath 后判定，不得当作合法路径。"""
    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "secret.docx"
    outside.write_bytes(b"top-secret")
    escaped = os.path.join(str(root), "..", "secret.docx")
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(escaped, roots=[str(root)])
    assert exc.value.code == path_guard.NOT_ALLOWED


@pytest.mark.skipif(os.name != "posix", reason="symlink 需要 POSIX 权限")
def test_symlink_pointing_outside_is_rejected(tmp_path):
    root = tmp_path / "allowed"
    root.mkdir()
    outside = tmp_path / "outside.mp3"
    outside.write_bytes(b"leak")
    link = root / "vo.mp3"
    link.symlink_to(outside)
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(str(link), roots=[str(root)])
    assert exc.value.code == path_guard.NOT_ALLOWED


def test_missing_file_inside_root_is_404(tmp_path):
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(str(tmp_path / "nope.mp3"), roots=[str(tmp_path)])
    assert exc.value.code == path_guard.NOT_FOUND
    assert exc.value.status_code == 404


def test_directory_is_not_a_file(tmp_path):
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(str(tmp_path), roots=[str(tmp_path)])
    assert exc.value.code == path_guard.NOT_A_FILE


def test_outside_root_missing_file_reports_403_not_404():
    """存在性判定顺序即信息泄露面：越权路径一律 403，不得用 404 回传「文件不存在」。"""
    ghost = os.path.join(tempfile.gettempdir(), "..", "definitely-not-here-9f3a1c.mp3")
    with pytest.raises(path_guard.AudioPathError) as exc:
        path_guard.resolve_audio_path(os.path.abspath(ghost), roots=[tempfile.gettempdir()])
    assert exc.value.code == path_guard.NOT_ALLOWED


def test_default_roots_fail_closed_to_temp_only(monkeypatch):
    monkeypatch.delenv(path_guard.ENV_ALLOWED_DIRS, raising=False)
    assert path_guard.allowed_roots() == [os.path.realpath(tempfile.gettempdir())]


def test_env_roots_are_split_and_deduplicated(monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    dup = str(tmp_path) + os.sep + "."  # 指向同一目录的不同写法，必须去重
    monkeypatch.setenv(
        path_guard.ENV_ALLOWED_DIRS,
        os.pathsep.join([dup, str(tmp_path), str(other), "  "]),
    )
    roots = path_guard.allowed_roots()
    assert roots == [os.path.realpath(str(tmp_path)), os.path.realpath(str(other))]


# --------------------------------------------------------------------------
# POST /align 的 HTTP 语义
# --------------------------------------------------------------------------

@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv(path_guard.ENV_ALLOWED_DIRS, str(tmp_path))
    called = {}

    def fake_transcribe(audio_path, **kwargs):
        called["audio_path"] = audio_path
        called["kwargs"] = kwargs
        return {"words": [], "segments": [], "language": "zh", "duration": 0.1, "elapsed_ms": 1, "model": "base"}

    monkeypatch.setattr(api_mod, "transcribe", fake_transcribe)
    tc = TestClient(api_mod.app)
    tc._called = called  # type: ignore[attr-defined]
    return tc


def _make_audio(tmp_path, name="vo.mp3"):
    f = tmp_path / name
    f.write_bytes(b"fake-audio")
    return str(f)


def test_align_accepts_file_inside_root(client, tmp_path, monkeypatch):
    audio = _make_audio(tmp_path)
    r = client.post("/align", json={"audio_path": audio})
    assert r.status_code == 200
    # 传给 ASR 的必须是规范化后的真实路径（而非调用方原样字符串）
    assert os.path.isabs(client._called["audio_path"])
    assert os.path.realpath(client._called["audio_path"]) == os.path.realpath(audio)


def test_align_rejects_path_outside_root(client, monkeypatch):
    outside = os.path.join(os.path.realpath(os.sep), "etc", "passwd")
    r = client.post("/align", json={"audio_path": outside})
    assert r.status_code == 403
    assert "audio_path" not in client._called  # 关键：越权请求不得触达 ASR
    assert "AUDIO_ALIGNER_ALLOWED_DIRS" in r.json()["detail"]


def test_align_rejects_relative_path(client):
    r = client.post("/align", json={"audio_path": "vo.mp3"})
    assert r.status_code == 400


def test_align_rejects_empty_path(client):
    r = client.post("/align", json={"audio_path": "   "})
    assert r.status_code == 400  # pydantic 允许空白串，由 path_guard 兜住


def test_align_missing_file_inside_root_is_404(client, tmp_path):
    r = client.post("/align", json={"audio_path": str(tmp_path / "ghost.mp3")})
    assert r.status_code == 404


def test_align_missing_env_falls_back_to_temp_only(monkeypatch):
    """未配置环境变量 ⇒ 默认只信系统临时目录；其它绝对路径 403（fail-closed）。

    注意不能用 tmp_path 造“外部路径”：pytest 的 tmp 就在系统临时目录下，会被默认策略合法接受。
    """
    monkeypatch.delenv(path_guard.ENV_ALLOWED_DIRS, raising=False)
    drive_root = os.path.splitdrive(os.path.abspath(os.getcwd()))[0] + os.sep
    outside_dir = os.path.join(drive_root, "outside-aligner-roots-9f3a1c")
    os.makedirs(outside_dir, exist_ok=True)
    audio = os.path.join(outside_dir, "vo.mp3")
    with open(audio, "wb") as fh:
        fh.write(b"x")
    try:
        with pytest.raises(path_guard.AudioPathError) as exc:
            path_guard.resolve_audio_path(audio)
        assert exc.value.code == path_guard.NOT_ALLOWED
    finally:
        os.remove(audio)
        os.rmdir(outside_dir)


def test_health_exposes_root_count_for_ops(monkeypatch):
    """403 排障时首先要能看见「当前允许哪些目录」，否则只能靠猜。"""
    monkeypatch.setenv(path_guard.ENV_ALLOWED_DIRS, os.pathsep.join([tempfile.gettempdir(), tempfile.gettempdir()]))
    body = TestClient(api_mod.app).get("/health").json()
    assert body["status"] == "ok"
    assert body["allowed_roots"] == [os.path.realpath(tempfile.gettempdir())]


def test_rejection_is_logged_with_code_and_path(client, caplog):
    with caplog.at_level("WARNING"):
        r = client.post("/align", json={"audio_path": os.path.join(os.sep, "etc", "passwd")})
    assert r.status_code == 403
    messages = [rec.getMessage() for rec in caplog.records]
    assert any("rejected=not_allowed" in m for m in messages), json.dumps(messages, ensure_ascii=False)
