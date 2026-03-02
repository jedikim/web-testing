"""Core recon models from docs/DEV_GUIDE.md and RECON_CODEGEN_ARCHITECTURE.md."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field


class SiteProfile(BaseModel):
    """Compact domain-level profile used by recon/codegen runtime."""

    domain: str
    purpose: str = "unknown"
    language: str = "unknown"
    region: str = "unknown"

    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_recon_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    recon_version: int = 1

    dom_hash: str = ""
    ax_hash: str = ""
    framework: str | None = None
    is_spa: bool = False
    url_pattern: str = "/"

    content_types: list[str] = Field(default_factory=list)
    repeating_patterns: list[str] = Field(default_factory=list)
    obstacle_types: list[str] = Field(default_factory=list)
    navigation_hints: list[str] = Field(default_factory=list)
    interaction_hints: list[str] = Field(default_factory=list)
    api_endpoints: list[str] = Field(default_factory=list)

    def to_markdown(self) -> str:
        """Render a short, human-readable profile summary."""
        lines = [
            f"# SiteProfile: {self.domain}",
            "",
            f"- purpose: {self.purpose}",
            f"- language/region: {self.language}/{self.region}",
            f"- version: {self.recon_version}",
            f"- framework: {self.framework or 'unknown'}",
            f"- spa: {self.is_spa}",
            f"- url_pattern: {self.url_pattern}",
            "",
            "## Signals",
            f"- content_types: {', '.join(self.content_types) or '-'}",
            f"- repeating_patterns: {', '.join(self.repeating_patterns) or '-'}",
            f"- obstacle_types: {', '.join(self.obstacle_types) or '-'}",
            f"- navigation_hints: {', '.join(self.navigation_hints) or '-'}",
            f"- interaction_hints: {', '.join(self.interaction_hints) or '-'}",
            f"- api_endpoints: {', '.join(self.api_endpoints) or '-'}",
            "",
            f"- dom_hash: {self.dom_hash}",
            f"- ax_hash: {self.ax_hash}",
            f"- created_at: {self.created_at.isoformat()}",
            f"- last_recon_at: {self.last_recon_at.isoformat()}",
        ]
        return "\n".join(lines)


class GeneratedBundle(BaseModel):
    """Generated runtime bundle for one URL pattern."""

    workflow_dsl: dict[str, Any]
    python_macro: str | None = None
    ts_macro: str | None = None
    prompts: dict[str, str] = Field(default_factory=dict)
    strategy: str = "dom_only"
    dependencies: list[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True)
class MaturityState:
    """Cold/Warm/Hot execution maturity state."""

    domain: str
    total_runs: int
    recent_success_rate: float
    consecutive_successes: int
    llm_calls_last_10: int

    def evaluate_stage(self) -> str:
        if self.total_runs <= 0:
            return "cold"
        if (
            self.recent_success_rate >= 0.95
            and self.consecutive_successes >= 10
            and self.llm_calls_last_10 == 0
        ):
            return "hot"
        if self.total_runs >= 3 and self.recent_success_rate >= 0.70:
            return "warm"
        return "cold"
