"""Promotion gate for generated bundles (replay/canary checks)."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.replay_runner import ReplayCase, WorkflowReplayRunner


@dataclass(frozen=True)
class PromotionDecision:
    replay_ok: bool
    canary_ok: bool
    overall: bool
    issues: list[str] = field(default_factory=list)
    replay_pass_rate: float = 0.0
    canary_pass_rate: float = 0.0


class PromotionGate:
    """Replay/canary gate before KB promotion.

    Replay runs deterministic workflow execution on synthetic cases.
    Canary adds lightweight domain/prompt/intent sanity checks + one execution case.
    """

    def __init__(
        self,
        *,
        replay_runner: WorkflowReplayRunner | None = None,
        replay_cases: list[ReplayCase] | None = None,
        canary_cases: list[ReplayCase] | None = None,
    ) -> None:
        self._replay_runner = replay_runner or WorkflowReplayRunner()
        self._replay_cases = replay_cases or [
            ReplayCase(name="baseline", context={"candidate_count": 3}),
            ReplayCase(name="list-rich", context={"candidate_count": 12}),
        ]
        self._canary_cases = canary_cases or [
            ReplayCase(name="canary-baseline", context={"candidate_count": 2}),
        ]

    def evaluate_bundle(
        self,
        *,
        bundle: GeneratedBundle,
        profile: SiteProfile,
        intent: str,
    ) -> PromotionDecision:
        issues: list[str] = []

        replay_report = self._replay_runner.run(bundle=bundle, cases=self._replay_cases)
        replay_ok = (
            replay_report.total_cases > 0
            and replay_report.passed_cases == replay_report.total_cases
        )
        replay_pass_rate = replay_report.pass_rate
        issues.extend(replay_report.issues)

        canary_checks_total = 4
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

        canary_report = self._replay_runner.run(bundle=bundle, cases=self._canary_cases)
        if (
            canary_report.total_cases > 0
            and canary_report.passed_cases == canary_report.total_cases
        ):
            canary_checks_passed += 1
        else:
            canary_ok = False
            issues.extend([f"canary:{issue}" for issue in canary_report.issues])

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
