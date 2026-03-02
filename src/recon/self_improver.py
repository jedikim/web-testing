"""Self-improvement remediation planner."""

from __future__ import annotations

from dataclasses import dataclass, field

from src.recon.failure_analyzer import FailureClassification


@dataclass(frozen=True)
class RemediationPlan:
    action: str
    requires_human: bool
    steps: list[str] = field(default_factory=list)


class SelfImprover:
    """Map classified failures to next remediation actions."""

    def plan_remediation(self, *, classification: FailureClassification) -> RemediationPlan:
        action = classification.recommended_action
        if action == "fix_selector":
            return RemediationPlan(
                action=action,
                requires_human=False,
                steps=[
                    "re-extract dom candidates",
                    "produce selector patch candidates",
                    "apply dsl patch with fallback selectors",
                ],
            )
        if action == "add_wait":
            return RemediationPlan(
                action=action,
                requires_human=False,
                steps=[
                    "increase wait timeout for failing step",
                    "add adaptive backoff",
                    "retry run with same bundle",
                ],
            )
        if action == "fix_obstacle":
            return RemediationPlan(
                action=action,
                requires_human=False,
                steps=[
                    "inject obstacle dismiss step",
                    "retry with same strategy",
                ],
            )
        if action == "change_strategy":
            return RemediationPlan(
                action=action,
                requires_human=False,
                steps=[
                    "switch strategy tier (dom -> hybrid -> vlm)",
                    "regenerate bundle with new strategy",
                ],
            )
        if action == "human_handoff":
            return RemediationPlan(
                action=action,
                requires_human=True,
                steps=[
                    "pause automation and request user input",
                    "resume after handoff resolution",
                ],
            )

        return RemediationPlan(
            action="full_recon",
            requires_human=False,
            steps=[
                "run full recon again",
                "regenerate bundle",
                "validate and promote",
            ],
        )
