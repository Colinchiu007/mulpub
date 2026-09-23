"""Render engine adapter package (ARCH-RENDER-ENGINE-ADAPTER).

Exposes the frozen schema (capabilities/context/result), the RenderEngineAdapter
ABC, and the RenderEngineRegistry. P0 covers three engines (remotion, hyperframes,
ffmpeg); atelier stays an orchestrator short-circuit in video_compose (A3).
"""
from multi_publish.video_creation.providers.video.engines.capabilities import (
    EngineCapabilities,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    StructuredBlocker,
    ValidationResult,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
    RenderResult,
)
from multi_publish.video_creation.providers.video.engines.base import (
    RenderEngineAdapter,
)
from multi_publish.video_creation.providers.video.engines.registry import (
    RenderEngineRegistry,
)

__all__ = [
    "EngineCapabilities",
    "PreflightResult",
    "StructuredBlocker",
    "ValidationResult",
    "RenderContext",
    "RenderRequest",
    "RenderResult",
    "RenderEngineAdapter",
    "RenderEngineRegistry",
]
