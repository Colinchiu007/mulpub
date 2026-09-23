"""Preflight / Validation / Blocker result types (ARCH section 2)."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PreflightResult:
    available: bool
    reason: str = ""


@dataclass(frozen=True)
class ValidationResult:
    ok: bool
    reason: str = ""


@dataclass(frozen=True)
class StructuredBlocker:
    code: str
    message: str
    options: tuple = ()
