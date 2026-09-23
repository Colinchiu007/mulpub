"""Contract tests for RenderEngineRegistry (T1, ARCH section 4 / A1)."""
from pathlib import Path

import pytest

from multi_publish.video_creation.providers.video.engines.base import (
    RenderEngineAdapter,
)
from multi_publish.video_creation.providers.video.engines.capabilities import (
    EngineCapabilities,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
)
from multi_publish.video_creation.providers.video.engines.registry import (
    RenderEngineRegistry,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    StructuredBlocker,
    ValidationResult,
)


def _ctx():
    return RenderContext(
        output_path=Path("out.mp4"),
        profile=None,
        asset_lookup={},
        proposal_packet=None,
        raw_inputs={},
    )


class _StubAdapter(RenderEngineAdapter):
    capabilities = EngineCapabilities(
        id="stub",
        name="Stub",
        upstream_version="0.0.1",
        paradigms=("x",),
        output_formats=("mp4",),
        max_resolution=(1920, 1080),
        word_level_captions=False,
        native_transitions=False,
        unavailable_fallback=None,
        requires_cmd=("stub",),
        requires_env=(),
    )

    def __init__(self, available=True):
        self._available = available

    def preflight(self, ctx):
        return PreflightResult(available=self._available, reason="" if self._available else "missing")

    def validate(self, req, ctx):
        return ValidationResult(ok=True)

    def render(self, req, ctx):
        raise NotImplementedError


def test_register_rejects_duplicate_id():
    reg = RenderEngineRegistry()
    reg.register("stub", lambda ctx: _StubAdapter())
    with pytest.raises(ValueError):
        reg.register("stub", lambda ctx: _StubAdapter())


def test_get_unknown_runtime_returns_blocker():
    reg = RenderEngineRegistry()
    res = reg.get("nope", _ctx())
    assert isinstance(res, StructuredBlocker)
    assert res.code == "UNKNOWN_RUNTIME"


def test_resolve_empty_runtime_returns_missing_blocker():
    reg = RenderEngineRegistry()
    res = reg.resolve({"render_runtime": "   "}, _ctx())
    assert isinstance(res, StructuredBlocker)
    assert res.code == "RUNTIME_MISSING"


def test_resolve_routes_by_string_case_insensitive():
    reg = RenderEngineRegistry()
    reg.register("stub", lambda ctx: _StubAdapter())
    res = reg.resolve({"render_runtime": "  StUb "}, _ctx())
    assert isinstance(res, _StubAdapter)


def test_resolve_ignores_preflight_availability(a1_hard_rule):
    # A1: routing must NOT consult preflight; an unavailable adapter still routes.
    reg = RenderEngineRegistry()
    reg.register("stub", lambda ctx: _StubAdapter(available=False))
    res = reg.resolve({"render_runtime": "stub"}, _ctx())
    assert isinstance(res, _StubAdapter)


def test_preflight_all_reports_per_engine():
    reg = RenderEngineRegistry()
    reg.register("ok", lambda ctx: _StubAdapter(available=True))
    reg.register("bad", lambda ctx: _StubAdapter(available=False))
    out = reg.preflight_all(_ctx())
    assert out["ok"].available is True
    assert out["bad"].available is False


@pytest.fixture
def a1_hard_rule():
    return True
