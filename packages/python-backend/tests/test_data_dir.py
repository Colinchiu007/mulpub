"""ensure_data_dir 回归测试：cmd set 尾随空格陷阱（mainBackend not_started 事故）。"""
from pathlib import Path

import pytest

from data_dir import ensure_data_dir


def test_default_when_empty(tmp_path: Path):
    d = ensure_data_dir("", tmp_path / "fallback")
    assert d == tmp_path / "fallback"
    assert d.exists()


def test_none_uses_default(tmp_path: Path):
    d = ensure_data_dir(None, tmp_path / "fallback2")
    assert d == tmp_path / "fallback2"
    assert d.exists()


def test_trailing_space_is_stripped(tmp_path: Path):
    target = tmp_path / "shared-user-data"
    d = ensure_data_dir(str(target) + "   ", tmp_path / "unused")
    assert d == target
    assert target.exists()


def test_leading_space_is_stripped(tmp_path: Path):
    target = tmp_path / "profile-dir"
    d = ensure_data_dir("  " + str(target), tmp_path / "unused")
    assert d == target
    assert target.exists()


def test_internal_stray_space_fails_fast_with_repr(tmp_path: Path):
    bogus = str(tmp_path / "shared-user-data") + " \\backend-data"
    with pytest.raises(SystemExit) as ei:
        ensure_data_dir(bogus, tmp_path / "unused")
    msg = str(ei.value)
    assert "FATAL" in msg
    assert "shared-user-data " in msg  # repr 让隐形成空格可见


def test_existing_dir_idempotent(tmp_path: Path):
    target = tmp_path / "exists"
    target.mkdir()
    (target / "keep.json").write_text("{}", encoding="utf-8")
    d = ensure_data_dir(str(target), tmp_path / "unused")
    assert d == target
    assert (target / "keep.json").exists()
