"""RenderContext / RenderRequest / RenderResult (ARCH section 2).

RenderResult carries an extra review_fail_label field (T5 extension, appended to
ARCH section 2): the unified final-review block in the orchestrator formats its
failure prefix from this label so the per-engine prose stays byte-identical.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from multi_publish.video_creation.providers.video.engines.result import (
    StructuredBlocker,
)


@dataclass(frozen=True)
class RenderContext:
    output_path: Path
    profile: Optional[dict]
    asset_lookup: dict
    proposal_packet: Optional[dict]
    raw_inputs: dict = field(default_factory=dict)


@dataclass(frozen=True)
class RenderRequest:
    edit_decisions: dict
    resolved_cuts: list
    asset_manifest: dict


@dataclass
class RenderResult:
    success: bool
    output_path: Optional[Path] = None
    error: Optional[str] = None
    blocker: Optional[StructuredBlocker] = None
    data: dict = field(default_factory=dict)
    review_fail_label: str = ""
