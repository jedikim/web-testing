"""Validation gate for generated DSL/macro bundles."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.recon.models import GeneratedBundle, SiteProfile


@dataclass(frozen=True)
class ValidationResult:
    dsl_ok: bool
    macro_ok: bool
    replay_ok: bool
    canary_ok: bool
    overall: bool
    errors: list[str] = field(default_factory=list)


class CodeValidator:
    """Lightweight validator used before promoting generated bundles."""

    def validate_bundle(
        self,
        *,
        bundle: GeneratedBundle,
        profile: SiteProfile,
        intent: str,
    ) -> ValidationResult:
        errors: list[str] = []
        dsl_ok, dsl_errors = self._validate_dsl(bundle.workflow_dsl)
        errors.extend(dsl_errors)

        macro_ok, macro_errors = self._validate_macros(bundle)
        errors.extend(macro_errors)

        replay_ok, replay_errors = self._validate_replay(bundle, profile, intent)
        errors.extend(replay_errors)

        canary_ok, canary_errors = self._validate_canary(bundle, profile)
        errors.extend(canary_errors)

        overall = dsl_ok and macro_ok and replay_ok and canary_ok
        return ValidationResult(
            dsl_ok=dsl_ok,
            macro_ok=macro_ok,
            replay_ok=replay_ok,
            canary_ok=canary_ok,
            overall=overall,
            errors=errors,
        )

    def _validate_dsl(self, workflow_dsl: dict[str, Any]) -> tuple[bool, list[str]]:
        errors: list[str] = []
        if not isinstance(workflow_dsl, dict):
            return False, ["workflow_dsl must be an object"]

        if not workflow_dsl.get("schema_version"):
            errors.append("dsl.schema_version is required")

        steps = workflow_dsl.get("steps")
        if not isinstance(steps, list) or not steps:
            errors.append("dsl.steps must be a non-empty list")
            return False, errors

        for idx, step in enumerate(steps):
            if not isinstance(step, dict):
                errors.append(f"dsl.steps[{idx}] must be an object")
                continue
            if "id" not in step:
                errors.append(f"dsl.steps[{idx}].id is required")
            if "action" not in step:
                errors.append(f"dsl.steps[{idx}].action is required")

        return len(errors) == 0, errors

    def _validate_macros(self, bundle: GeneratedBundle) -> tuple[bool, list[str]]:
        errors: list[str] = []
        if bundle.python_macro:
            try:
                compile(bundle.python_macro, "<generated-macro.py>", "exec")
            except SyntaxError as exc:
                errors.append(f"python_macro syntax error: {exc.msg}")

        if bundle.ts_macro and "function" not in bundle.ts_macro and "=>" not in bundle.ts_macro:
            errors.append("ts_macro does not appear to define executable function code")

        return len(errors) == 0, errors

    def _validate_replay(
        self,
        bundle: GeneratedBundle,
        profile: SiteProfile,
        intent: str,
    ) -> tuple[bool, list[str]]:
        del profile, intent
        steps = bundle.workflow_dsl.get("steps", [])
        if not isinstance(steps, list):
            return False, ["dsl.steps missing for replay validation"]
        if len(steps) > 60:
            return False, ["dsl.steps exceeds replay guard limit (60)"]
        return True, []

    def _validate_canary(
        self,
        bundle: GeneratedBundle,
        profile: SiteProfile,
    ) -> tuple[bool, list[str]]:
        errors: list[str] = []
        if not bundle.prompts:
            errors.append("prompts must not be empty")
        if "extract" not in bundle.prompts:
            errors.append("prompts.extract is required")
        domain = bundle.workflow_dsl.get("domain")
        if domain and domain != profile.domain:
            errors.append("dsl.domain must match profile.domain")
        return len(errors) == 0, errors
