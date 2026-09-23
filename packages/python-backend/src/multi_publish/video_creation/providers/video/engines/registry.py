"""RenderEngineRegistry (ARCH section 4).

A1 hard rule: resolve() routes purely on composition_mode + render_runtime
strings; preflight()/validate() never participate in routing (they only feed
get_info reporting and pre-render fail-fast). Unknown id -> UNKNOWN_RUNTIME
blocker; empty runtime -> RUNTIME_MISSING. Factories are registered, not
instances, so there is no cross-call subprocess state.
"""
from __future__ import annotations

from typing import Callable, Union

from multi_publish.video_creation.providers.video.engines.base import (
    RenderEngineAdapter,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    StructuredBlocker,
)


class RenderEngineRegistry:
    def __init__(self) -> None:
        self._factories: "dict[str, Callable[[RenderContext], RenderEngineAdapter]]" = {}

    def register(self, runtime_id: str, factory: Callable) -> None:
        if runtime_id in self._factories:
            raise ValueError("duplicate adapter id registered: %s" % runtime_id)
        self._factories[runtime_id] = factory

    def ids(self) -> tuple:
        return tuple(self._factories.keys())

    def get(self, runtime_id: str, ctx: RenderContext) -> Union[RenderEngineAdapter, StructuredBlocker]:
        factory = self._factories.get(runtime_id)
        if factory is None:
            return StructuredBlocker(
                code="UNKNOWN_RUNTIME",
                message="Unknown render_runtime: %r" % (runtime_id,),
            )
        return factory(ctx)

    def resolve(self, edit_decisions: dict, ctx: RenderContext) -> Union[RenderEngineAdapter, StructuredBlocker]:
        runtime = str((edit_decisions or {}).get("render_runtime", "") or "").strip().lower()
        if not runtime:
            return StructuredBlocker(
                code="RUNTIME_MISSING",
                message="render_runtime is empty; set it explicitly in edit_decisions",
            )
        return self.get(runtime, ctx)

    def capabilities_all(self, ctx: RenderContext) -> "dict[str, object]":
        """Return each registered engine's static EngineCapabilities descriptor.

        get_info() sources capability reporting from here (ARCH A5 single source).
        Factories are constructed with a throwaway ctx purely to read the frozen
        class-level capabilities; no subprocess or availability probe happens.
        """
        out: "dict[str, object]" = {}
        for runtime_id, factory in self._factories.items():
            out[runtime_id] = factory(ctx).capabilities
        return out

    def preflight_all(self, ctx: RenderContext) -> "dict[str, PreflightResult]":
        out: "dict[str, PreflightResult]" = {}
        for runtime_id, factory in self._factories.items():
            try:
                out[runtime_id] = factory(ctx).preflight(ctx)
            except Exception as exc:  # never let one engine's probe break the report
                out[runtime_id] = PreflightResult(available=False, reason=str(exc))
        return out
