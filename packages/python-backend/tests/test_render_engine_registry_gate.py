"""T5 architecture gate (ARCH A7 / DEV-PLAN 3.4): the engine switch is real.

Proves the _render string if/elif was replaced by registry dispatch, that the
per-runtime path survives only as _render_via_* helpers reached through the
adapters, and that the same-shape passthrough fields exist. This is the
structural counterpart to the behavioural baselines.
"""
import inspect

from multi_publish.video_creation.providers.video.engines import (
    RenderEngineRegistry,
    RenderResult,
)
from multi_publish.video_creation.providers.video.video_compose import VideoCompose


def _render_source():
    return inspect.getsource(VideoCompose._render)


def test_render_dispatches_via_registry_not_string_ifelif():
    body = _render_source()
    # No direct per-runtime method calls remain in the orchestrator.
    for gone in ("self._render_via_ffmpeg(", "self._render_via_hyperframes(",
                 'render_runtime == "ffmpeg"', 'render_runtime == "hyperframes"'):
        assert gone not in body, "orchestrator still hard-codes: " + gone
    assert "self._engine_registry()" in body, "_render must route via the registry"
    assert ".render(req, ctx)" in body, "_render must call the adapter render()"
    assert "result.tool_result" in body, "_render must return the verbatim tool_result"


def test_render_still_owns_governance_prose():
    # empty-runtime and unknown-runtime are orchestrator governance (not adapters).
    body = _render_source()
    assert "render_runtime is not set in edit_decisions" in body
    assert "Unknown render_runtime" in body


def test_render_via_paths_remain_defined_for_adapters():
    for name in ("_render_via_ffmpeg", "_render_via_hyperframes",
                 "_render_via_remotion", "_render_via_atelier"):
        assert callable(getattr(VideoCompose, name)), name + " must exist"


def test_registry_wires_three_host_bound_factories():
    reg = VideoCompose()._engine_registry()
    assert set(reg.ids()) == {"remotion", "hyperframes", "ffmpeg"}
    # factories, not instances: two lookups yield distinct adapter objects.
    from pathlib import Path

    from multi_publish.video_creation.providers.video.engines.context import RenderContext
    ctx = RenderContext(output_path=Path("x.mp4"), profile=None,
                        asset_lookup={}, proposal_packet=None)
    a1 = reg.get("ffmpeg", ctx)
    a2 = reg.get("ffmpeg", ctx)
    assert a1 is not a2
    assert a1._host is not None


def test_render_result_same_shape_fields_exist():
    import dataclasses
    names = {f.name for f in dataclasses.fields(RenderResult)}
    assert {"artifacts", "tool_result"} <= names, names


def test_registry_exposes_capabilities_all():
    assert hasattr(RenderEngineRegistry, "capabilities_all")
