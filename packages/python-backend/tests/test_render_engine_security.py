"""T6 security regressions (ARCH/DEV-PLAN section 2, T6; PRD C9; finding F-2).

  - run_command launches subprocess with shell=False and a list argv (no string
    shell concatenation)
  - the capture seam records the LOGICAL argv (pre shutil.which rewrite)
  - the seam is a strict no-op when unset (default None)
  - documents the HyperFrames import-path fact (F-2) as a regression lock
"""
import importlib
import subprocess
from unittest.mock import patch

import pytest

from multi_publish.video_creation.base_tool import BaseTool
from multi_publish.video_creation.providers.video.video_compose import VideoCompose


def test_run_command_uses_shell_false_and_list_args():
    vc = VideoCompose()
    captured = {}

    def fake_run(cmd, **kwargs):
        captured["cmd"] = cmd
        captured["kwargs"] = kwargs
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    with patch("multi_publish.video_creation.base_tool.subprocess.run", side_effect=fake_run):
        vc.run_command(["ffmpeg", "-y", "-i", "input.mp4"])
    assert isinstance(captured["cmd"], list)
    assert captured["kwargs"].get("shell", False) is False


def test_seam_records_logical_argv_before_which():
    vc = VideoCompose()
    rec = []
    vc._cmd_capture = lambda cmd, cwd, timeout: rec.append((cmd, cwd, timeout))
    with patch.object(BaseTool, "run_command", return_value=subprocess.CompletedProcess([], 0)):
        vc.run_command(["npx", "remotion", "render"], timeout=600, cwd=None)
    assert rec, "capture callback was not invoked"
    assert rec[0][0][:2] == ["npx", "remotion"]  # logical argv, not absolute which path
    assert rec[0][2] == 600


def test_seam_default_none_is_noop():
    assert VideoCompose._cmd_capture is None
    vc = VideoCompose()
    with patch.object(BaseTool, "run_command", return_value=subprocess.CompletedProcess([], 0)) as m:
        vc.run_command(["ffmpeg"])
    m.assert_called_once()


def test_hyperframes_import_path_f2_lock():
    # F-2: video_compose imports from video_creation.video (does NOT exist);
    # the real tool lives under providers.video. This silently-swallowed bad
    # import makes hyperframes always report unavailable. Locking the fact here
    # so a future fix is an intentional, documented behavior change (not a
    # silent side effect of the refactor).
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("multi_publish.video_creation.video")
    real = importlib.import_module(
        "multi_publish.video_creation.providers.video.hyperframes_compose"
    )
    assert hasattr(real, "HyperFramesCompose")
