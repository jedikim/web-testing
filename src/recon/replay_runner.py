"""Deterministic replay runner for promotion/canary gate checks."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from src.recon.models import GeneratedBundle


@dataclass(frozen=True)
class ReplayCase:
    """One replay input case with deterministic context hints."""

    name: str
    context: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class ReplayCaseResult:
    """Replay outcome for a single case."""

    case: str
    ok: bool
    error: str | None = None
    executed_steps: int = 0


@dataclass(frozen=True)
class ReplayReport:
    """Aggregated replay report for a bundle."""

    total_cases: int
    passed_cases: int
    pass_rate: float
    results: list[ReplayCaseResult] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)


class WorkflowReplayRunner:
    """Execute workflow DSL in-memory for deterministic replay checks.

    This is intentionally strict and side-effect free. It validates step ordering
    and basic action semantics without requiring browser startup.
    """

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

    def __init__(self, *, max_steps: int = 60) -> None:
        self.max_steps = max(1, max_steps)

    def run(
        self,
        *,
        bundle: GeneratedBundle,
        cases: list[ReplayCase],
    ) -> ReplayReport:
        if not cases:
            return ReplayReport(
                total_cases=0,
                passed_cases=0,
                pass_rate=0.0,
                results=[],
                issues=["replay: at least one replay case is required"],
            )

        results: list[ReplayCaseResult] = []
        issues: list[str] = []
        for case in cases:
            outcome = self._run_single_case(bundle=bundle, case=case)
            results.append(outcome)
            if not outcome.ok:
                issues.append(f"replay:{case.name}: {outcome.error or 'unknown error'}")

        passed = sum(1 for row in results if row.ok)
        total = len(results)
        return ReplayReport(
            total_cases=total,
            passed_cases=passed,
            pass_rate=(passed / total) if total else 0.0,
            results=results,
            issues=issues,
        )

    def _run_single_case(self, *, bundle: GeneratedBundle, case: ReplayCase) -> ReplayCaseResult:
        raw_steps = bundle.workflow_dsl.get("steps")
        if not isinstance(raw_steps, list) or not raw_steps:
            return ReplayCaseResult(
                case=case.name,
                ok=False,
                error="workflow requires non-empty steps",
            )
        if len(raw_steps) > self.max_steps:
            return ReplayCaseResult(
                case=case.name,
                ok=False,
                error=f"workflow step limit exceeded ({self.max_steps})",
            )

        context: dict[str, Any] = dict(case.context)
        executed = 0
        verify_present = False

        for idx, step in enumerate(raw_steps):
            if not isinstance(step, dict):
                return ReplayCaseResult(
                    case=case.name,
                    ok=False,
                    error=f"step[{idx}] must be object",
                )

            action = str(step.get("action") or "").strip()
            if not action:
                return ReplayCaseResult(
                    case=case.name,
                    ok=False,
                    error=f"step[{idx}] missing action",
                )
            if action not in self._ALLOWED_ACTIONS:
                return ReplayCaseResult(
                    case=case.name,
                    ok=False,
                    error=f"unsupported action '{action}' at step[{idx}]",
                )

            err = self._apply_action(action=action, step=step, context=context)
            if err is not None:
                return ReplayCaseResult(
                    case=case.name,
                    ok=False,
                    error=err,
                    executed_steps=executed,
                )

            if action == "verify_result":
                verify_present = True

            executed += 1

        if not verify_present:
            return ReplayCaseResult(
                case=case.name,
                ok=False,
                error="verify_result step is required",
            )

        return ReplayCaseResult(case=case.name, ok=True, executed_steps=executed)

    def _apply_action(
        self,
        *,
        action: str,
        step: dict[str, Any],
        context: dict[str, Any],
    ) -> str | None:
        if action == "goto":
            target = step.get("target")
            if not isinstance(target, str) or not target.strip():
                return "goto requires non-empty target"
            context["current_url"] = target
            return None

        if action == "capture_dom":
            context["dom_captured"] = True
            return None

        if action == "extract_candidates":
            candidates = context.get("candidate_count")
            if candidates is None:
                params = step.get("params")
                if isinstance(params, dict) and isinstance(params.get("min_candidates"), int):
                    candidates = max(0, int(params["min_candidates"]))
                else:
                    candidates = 3
            try:
                context["candidate_count"] = max(0, int(candidates))
            except (TypeError, ValueError):
                return "extract_candidates requires integer-like candidate_count"
            return None

        if action == "verify_result":
            verify = step.get("verify") if isinstance(step.get("verify"), dict) else {}
            min_items = verify.get("min_items", 1)
            try:
                needed = max(0, int(min_items))
            except (TypeError, ValueError):
                return "verify_result.min_items must be int"
            current = int(context.get("candidate_count", 0))
            if current < needed:
                return f"verify_result failed: candidate_count={current} < min_items={needed}"
            return None

        # Click/type/select/wait/scroll/hover are accepted as deterministic no-op in replay.
        return None
