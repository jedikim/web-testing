"""Deterministic DSL patcher for failure-driven self-improvement."""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass

from src.recon.failure_analyzer import FailureClassification
from src.recon.models import GeneratedBundle
from src.recon.self_improver import RemediationPlan


@dataclass(frozen=True)
class PatchDecision:
    patched: bool
    reason: str
    bundle: GeneratedBundle | None = None


class WorkflowPatcher:
    """Apply small deterministic patches to workflow DSL based on failure category."""

    def patch_bundle(
        self,
        *,
        bundle: GeneratedBundle,
        classification: FailureClassification,
        plan: RemediationPlan,
        failed_step_id: str | None = None,
    ) -> PatchDecision:
        if plan.requires_human or classification.category == "security":
            return PatchDecision(patched=False, reason="human_handoff", bundle=None)

        action = classification.recommended_action
        workflow = deepcopy(bundle.workflow_dsl)
        steps_raw = workflow.get("steps", [])
        if not isinstance(steps_raw, list) or not steps_raw:
            return PatchDecision(patched=False, reason="missing_steps", bundle=None)

        steps = deepcopy(steps_raw)
        if action == "add_wait":
            idx = self._find_step_index(steps=steps, failed_step_id=failed_step_id)
            wait_step = {
                "id": f"auto_wait_before_{failed_step_id or 'step'}",
                "action": "wait",
                "params": {"ms": 1500, "reason": "timing_recovery"},
            }
            steps.insert(idx, wait_step)
            workflow["steps"] = steps
            patched = self._rebuild(bundle=bundle, workflow_dsl=workflow)
            return PatchDecision(patched=True, reason="add_wait", bundle=patched)

        if action == "fix_selector":
            idx = self._find_step_index(steps=steps, failed_step_id=failed_step_id)
            target = steps[idx]
            if not isinstance(target, dict):
                return PatchDecision(patched=False, reason="invalid_step", bundle=None)
            params = target.get("params")
            if not isinstance(params, dict):
                params = {}
            params["selector_recovery"] = "semantic_fallback"
            target["params"] = params
            steps[idx] = target
            workflow["steps"] = steps
            patched = self._rebuild(bundle=bundle, workflow_dsl=workflow)
            return PatchDecision(patched=True, reason="fix_selector", bundle=patched)

        if action == "fix_obstacle":
            idx = self._find_step_index(steps=steps, failed_step_id=failed_step_id)
            hover_step = {
                "id": f"auto_hover_before_{failed_step_id or 'step'}",
                "action": "hover",
                "target": "menu_or_overlay_anchor",
                "params": {"reason": "interaction_recovery"},
            }
            steps.insert(idx, hover_step)
            workflow["steps"] = steps
            patched = self._rebuild(bundle=bundle, workflow_dsl=workflow)
            return PatchDecision(patched=True, reason="fix_obstacle", bundle=patched)

        if action == "change_strategy":
            workflow["strategy_hint"] = "escalate_higher_tier"
            patched = self._rebuild(bundle=bundle, workflow_dsl=workflow)
            return PatchDecision(patched=True, reason="change_strategy", bundle=patched)

        return PatchDecision(patched=False, reason=action, bundle=None)

    @staticmethod
    def _find_step_index(steps: list[dict], failed_step_id: str | None) -> int:
        if failed_step_id:
            for idx, step in enumerate(steps):
                if isinstance(step, dict) and str(step.get("id")) == failed_step_id:
                    return idx
        return max(0, len(steps) - 1)

    @staticmethod
    def _rebuild(*, bundle: GeneratedBundle, workflow_dsl: dict) -> GeneratedBundle:
        return GeneratedBundle(
            workflow_dsl=workflow_dsl,
            python_macro=bundle.python_macro,
            ts_macro=bundle.ts_macro,
            prompts=dict(bundle.prompts),
            strategy=bundle.strategy,
            dependencies=list(bundle.dependencies),
        )
