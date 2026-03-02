"""LiteLLM-style provider/model alias registry.

This module keeps runtime model selection deterministic and env-driven.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from enum import StrEnum


class ModelRole(StrEnum):
    FAST = "fast"
    STRONG = "strong"
    CODEGEN = "codegen"
    VISION = "vision"


@dataclass(frozen=True)
class ModelRegistry:
    """Resolved provider and role->model map."""

    provider: str
    models: dict[ModelRole, str]

    def model_for(self, role: ModelRole) -> str:
        return self.models[role]

    def to_litellm_alias_map(self) -> dict[str, str]:
        return {role.value: model for role, model in self.models.items()}


def build_model_registry(env: dict[str, str] | None = None) -> ModelRegistry:
    """Build provider/model mapping from environment variables."""
    if env is None:
        env = dict(os.environ)

    has_gemini = bool(env.get("GEMINI_API_KEY"))
    has_openai = bool(env.get("OPENAI_API_KEY"))

    if has_gemini:
        flash = env.get("GEMINI_FLASH_MODEL", "gemini-3-flash-preview")
        pro = env.get("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview")
        return ModelRegistry(
            provider="gemini",
            models={
                ModelRole.FAST: flash,
                ModelRole.STRONG: pro,
                ModelRole.CODEGEN: pro,
                ModelRole.VISION: flash,
            },
        )

    if has_openai:
        fast = env.get("OPENAI_FAST_MODEL", "gpt-5-mini")
        strong = env.get("OPENAI_STRONG_MODEL", "gpt-5.3-codex")
        return ModelRegistry(
            provider="openai",
            models={
                ModelRole.FAST: fast,
                ModelRole.STRONG: strong,
                ModelRole.CODEGEN: strong,
                ModelRole.VISION: fast,
            },
        )

    # Default to Gemini aliases even if keys are absent. This keeps
    # deterministic config output and lets startup validation handle key checks.
    return ModelRegistry(
        provider="gemini",
        models={
            ModelRole.FAST: env.get("GEMINI_FLASH_MODEL", "gemini-3-flash-preview"),
            ModelRole.STRONG: env.get("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview"),
            ModelRole.CODEGEN: env.get("GEMINI_PRO_MODEL", "gemini-3.1-pro-preview"),
            ModelRole.VISION: env.get("GEMINI_FLASH_MODEL", "gemini-3-flash-preview"),
        },
    )
