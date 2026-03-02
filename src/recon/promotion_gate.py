"""Promotion gate for generated bundles (replay/canary stub)."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.recon.models import GeneratedBundle, SiteProfile


@dataclass(frozen=True)
class PromotionDecision:
    replay_ok: bool
    canary_ok: bool
    overall: bool
    issues: list[str] = field(default_factory=list)
    replay_pass_rate: float = 0.0
    canary_pass_rate: float = 0.0


class PromotionGate:
    """Deterministic replay/canary gate before KB promotion."""

    _ALLOWED_ACTIONS = {
        "goto",
        "capture_dom",
        "extract_candidates",
        "verify_result",
        "click",
        "type",
        "select",
        "wait",
        "scroll",
        "hover",
    }

    def evaluate_bundle(
        self,
        *,
        bundle: GeneratedBundle,
        profile: SiteProfile,
        intent: str,
    ) -> PromotionDecision:
        issues: list[str] = []

        replay_checks_total = 3
        replay_checks_passed = 0
        replay_ok = True

        steps = bundle.workflow_dsl.get("steps")
        if isinstance(steps, list) and steps:
            replay_checks_passed += 1
        else:
            replay_ok = False
            issues.append("replay: workflow requires non-empty steps")
            steps = []

        if len(steps) <= 60:
            replay_checks_passed += 1
        else:
            replay_ok = False
            issues.append("replay: step count exceeds guard limit (60)")

        has_verify_step = any(
            isinstance(step, dict) and step.get("action") == "verify_result"
            for step in steps
        )
        if has_verify_step:
            replay_checks_passed += 1
        else:
            replay_ok = False
            issues.append("replay: verify_result step is required")

        for idx, step in enumerate(steps):
            if not isinstance(step, dict):
                replay_ok = False
                issues.append(f"replay: step[{idx}] must be object")
                continue
            action = str(step.get("action") or "").strip()
            if action and action not in self._ALLOWED_ACTIONS:
                replay_ok = False
                issues.append(f"replay: unsupported action '{action}' at step[{idx}]")

        replay_pass_rate = replay_checks_passed / replay_checks_total

        canary_checks_total = 3
        canary_checks_passed = 0
        canary_ok = True

        if bundle.workflow_dsl.get("domain") in {None, profile.domain}:
            canary_checks_passed += 1
        else:
            canary_ok = False
            issues.append("canary: dsl.domain must match profile.domain")

        if "extract" in bundle.prompts and "verify" in bundle.prompts:
            canary_checks_passed += 1
        else:
            canary_ok = False
            issues.append("canary: prompts.extract and prompts.verify are required")

        if intent.strip():
            canary_checks_passed += 1
        else:
            canary_ok = False
            issues.append("canary: intent must not be empty")

        canary_pass_rate = canary_checks_passed / canary_checks_total

        overall = replay_ok and canary_ok
        return PromotionDecision(
            replay_ok=replay_ok,
            canary_ok=canary_ok,
            overall=overall,
            issues=issues,
            replay_pass_rate=replay_pass_rate,
            canary_pass_rate=canary_pass_rate,
        )
