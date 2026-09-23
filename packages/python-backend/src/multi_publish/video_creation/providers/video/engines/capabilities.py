"""EngineCapabilities: single-source declarative capability descriptor.

Frozen dataclass per ARCH-RENDER-ENGINE-ADAPTER section 2. Capability facts that
were previously scattered across get_info prose are consolidated here; the C10
gate (test_render_engine_capabilities.py) asserts ground-truth values.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


@dataclass(frozen=True)
class EngineCapabilities:
    id: str
    name: str
    upstream_version: str
    paradigms: tuple
    output_formats: tuple
    max_resolution: tuple
    word_level_captions: bool
    native_transitions: bool
    unavailable_fallback: Optional[str]
    requires_cmd: tuple
    requires_env: tuple
    notes: str = ""
