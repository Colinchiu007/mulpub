"""T6 governance regressions (ARCH/DEV-PLAN section 2, T6).

Locks the CURRENT _render runtime-routing governance semantics so the future
cutover (T5) cannot silently change them:
  - empty render_runtime -> governance error text (never defaults)
  - unknown render_runtime -> Unknown error text
  - atelier short-circuits BEFORE any render_runtime read (RF-1)
_pre_compose_validation is a separately-covered gate, mocked here to isolate
the routing branch under test.
"""
import subprocess
from unittest.mock import patch

import pytest

import multi_publish.video_creation.providers.video.video_compose as vc_mod
from multi_publish.video_creation.providers.video.video_compose import VideoCompose

ToolResult = vc_mod.ToolResult


def _inputs(tmp_path, render_runtime):
    return {
        "operation": "render",
        "edit_decisions": {
            "render_runtime": render_runtime,
            "renderer_family": "remotion",
            "cuts": [{"source": "a1", "type": "video"}],
        },
        "asset_manifest": {"assets": [{"id": "a1", "path": str(tmp_path / "a.mp4")}]},
        "output_path": str(tmp_path / "renders" / "out.mp4"),
    }


@pytest.fixture
def vc():
    return VideoCompose()


def test_empty_runtime_returns_governance_error(vc, tmp_path):
    inputs = _inputs(tmp_path, "")
    with patch.object(VideoCompose, "_pre_compose_validation", return_value=None):
        res = vc._render(inputs)
    assert res.success is False
    assert "render_runtime is not set" in (res.error or "")


def test_unknown_runtime_returns_error(vc, tmp_path):
    inputs = _inputs(tmp_path, "bogus-engine")
    with patch.object(VideoCompose, "_pre_compose_validation", return_value=None):
        res = vc._render(inputs)
    assert res.success is False
    assert "Unknown render_runtime" in (res.error or "")


def test_whitespace_runtime_treated_as_missing(vc, tmp_path):
    inputs = _inputs(tmp_path, "   ")
    with patch.object(VideoCompose, "_pre_compose_validation", return_value=None):
        res = vc._render(inputs)
    assert res.success is False
    assert "render_runtime is not set" in (res.error or "")


def test_atelier_shortcircuits_before_runtime_read(vc, tmp_path):
    # RF-1: even with an empty render_runtime, atelier must be routed first.
    hits = []

    def fake_atelier(self, inputs, edit_decisions):
        hits.append(edit_decisions.get("composition_mode"))
        return ToolResult(success=True, data={"ok": True})

    inputs = _inputs(tmp_path, "")
    inputs["edit_decisions"]["composition_mode"] = "atelier"
    with patch.object(VideoCompose, "_render_via_atelier", fake_atelier):
        res = vc._render(inputs)
    assert hits == ["atelier"]
    assert res.success is True


def test_missing_edit_decisions_rejected(vc):
    res = vc._render({})
    assert res.success is False
    assert "edit_decisions required" in (res.error or "")
