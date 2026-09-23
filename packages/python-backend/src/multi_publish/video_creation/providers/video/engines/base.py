"""RenderEngineAdapter ABC (ARCH section 3, P0 frozen contract).

Safety (PRD C9): render()/preflight() must launch subprocesses with
subprocess.run([...], shell=False) and pass args as a list; paths go through a
whitelist. Supply-chain (A6): any `npx <pkg>` call must pin version or resolve
from local node_modules (--offline); never accept a caller-controlled package
name for npx execution.
"""
from __future__ import annotations

from abc import ABC, abstractmethod

from multi_publish.video_creation.providers.video.engines.capabilities import (
    EngineCapabilities,
)
from multi_publish.video_creation.providers.video.engines.context import (
    RenderContext,
    RenderRequest,
    RenderResult,
)
from multi_publish.video_creation.providers.video.engines.result import (
    PreflightResult,
    ValidationResult,
)


class RenderEngineAdapter(ABC):
    capabilities: EngineCapabilities

    @abstractmethod
    def preflight(self, ctx: RenderContext) -> PreflightResult:
        ...

    @abstractmethod
    def validate(self, req: RenderRequest, ctx: RenderContext) -> ValidationResult:
        ...

    @abstractmethod
    def render(self, req: RenderRequest, ctx: RenderContext) -> RenderResult:
        ...
