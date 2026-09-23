"""C10 capability single-source gate (T1 first version; ARCH section 6).

Ground-truth assertions for the three real adapters are added in T2-T4 once the
adapters exist. This first version exercises the discipline against a fixture
registry so the gate is wired into the pytest suite from day one.
"""
import dataclasses

import pytest

from multi_publish.video_creation.providers.video.engines.base import (
    RenderEngineAdapter,
)
from multi_publish.video_creation.providers.video.engines.capabilities import (
    EngineCapabilities,
)
from multi_publish.video_creation.providers.video.engines.registry import (
    RenderEngineRegistry,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    StructuredBlocker,
    ValidationResult,
)


class _Fx(RenderEngineAdapter):
    def __init__(self, caps):
        self.capabilities = caps

    def preflight(self, ctx):
        return PreflightResult(available=True)

    def validate(self, req, ctx):
        return ValidationResult(ok=True)

    def render(self, req, ctx):
        raise NotImplementedError


def _caps(id_, wlc=False):
    return EngineCapabilities(
        id=id_, name=id_.title(), upstream_version="1.0.0",
        paradigms=("p",), output_formats=("mp4",), max_resolution=(1920, 1080),
        word_level_captions=wlc, native_transitions=False,
        unavailable_fallback=None, requires_cmd=(id_,), requires_env=(),
    )


def test_capabilities_frozen():
    c = _caps("x")
    with pytest.raises(dataclasses.FrozenInstanceError):
        c.id = "y"


def test_registry_ids_unique_and_single():
    reg = RenderEngineRegistry()
    reg.register("a", lambda ctx: _Fx(_caps("a")))
    reg.register("b", lambda ctx: _Fx(_caps("b")))
    ids = reg.ids()
    assert len(ids) == len(set(ids))
    assert set(ids) == {"a", "b"}


def test_registering_same_id_twice_blocked():
    reg = RenderEngineRegistry()
    reg.register("a", lambda ctx: _Fx(_caps("a")))
    with pytest.raises(ValueError):
        reg.register("a", lambda ctx: _Fx(_caps("a")))
