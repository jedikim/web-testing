"""Runtime helper for URL-pattern bundle lookup and run logging."""

from __future__ import annotations

import inspect
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

from src.recon.change_detector import ChangeDetector
from src.recon.codegen import CodeGenAgent
from src.recon.failure_analyzer import FailureAnalyzer
from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile
from src.recon.promotion_gate import PromotionGate
from src.recon.self_improver import SelfImprover
from src.recon.validator import CodeValidator


@dataclass(frozen=True)
class RuntimeLookup:
    domain: str
    url: str
    url_pattern: str | None
    bundle: Any | None
    workflow_version: int | None
    prompt_version: int | None


@dataclass(frozen=True)
class StepExecutionResult:
    ok: bool
    error: str | None = None
    verify_code: str | None = None
    evidence: dict[str, Any] | None = None


class ICodeGenAgent(Protocol):
    def generate_bundle(
        self,
        *,
        profile: SiteProfile,
        url: str,
        intent: str,
        runtime_stats: dict[str, dict[str, float | int]] | None = None,
    ) -> Any: ...


class IWorkflowStepRunner(Protocol):
    def run_step(self, *, step: dict[str, Any], context: dict[str, Any]) -> StepExecutionResult: ...


class IPromotionGate(Protocol):
    def evaluate_bundle(self, *, bundle: Any, profile: SiteProfile, intent: str) -> Any: ...


class DeterministicStepRunner:
    """Deterministic fallback runner for common workflow DSL actions."""

    def __init__(self, default_candidate_count: int = 3) -> None:
        self.default_candidate_count = max(0, default_candidate_count)

    def run_step(self, *, step: dict[str, Any], context: dict[str, Any]) -> StepExecutionResult:
        action = str(step.get("action") or "").strip()
        if not action:
            return StepExecutionResult(ok=False, error="missing action")

        if action == "goto":
            target = step.get("target")
            if not isinstance(target, str) or not target:
                return StepExecutionResult(ok=False, error="missing target for goto")
            context["current_url"] = target
            return StepExecutionResult(ok=True, evidence={"url": target})

        if action == "capture_dom":
            context["dom_captured"] = True
            return StepExecutionResult(ok=True, evidence={"dom_captured": True})

        if action == "extract_candidates":
            count = self.default_candidate_count
            params = step.get("params")
            if isinstance(params, dict):
                raw = params.get("min_candidates")
                if isinstance(raw, int):
                    count = max(0, raw)
            context["candidate_count"] = count
            return StepExecutionResult(ok=True, evidence={"candidate_count": count})

        if action == "verify_result":
            verify = step.get("verify")
            min_items = 1
            if isinstance(verify, dict):
                raw = verify.get("min_items")
                if isinstance(raw, int):
                    min_items = max(0, raw)
            candidate_count = int(context.get("candidate_count", 0))
            if candidate_count < min_items:
                return StepExecutionResult(
                    ok=False,
                    error="empty data: insufficient result items",
                    verify_code="EXPECT_SELECTOR_MISSING",
                    evidence={"candidate_count": candidate_count, "min_items": min_items},
                )
            return StepExecutionResult(
                ok=True,
                evidence={"candidate_count": candidate_count, "min_items": min_items},
            )

        return StepExecutionResult(ok=False, error=f"unknown action: {action}")


class ReconRuntime:
    """Minimal runtime bridge: lookup bundle and append versioned run logs."""

    _RETRYABLE_FAILURE_CATEGORIES = {"timing", "selector", "interaction", "rendering", "data"}

    def __init__(self, kb: KnowledgeBase) -> None:
        self.kb = kb
        self.failure_analyzer = FailureAnalyzer()
        self.self_improver = SelfImprover()

    def resolve(self, *, domain: str, url: str) -> RuntimeLookup:
        pattern = self.kb.resolve_pattern_for_url(domain, url)
        if pattern is None:
            return RuntimeLookup(
                domain=domain,
                url=url,
                url_pattern=None,
                bundle=None,
                workflow_version=None,
                prompt_version=None,
            )
        bundle = self.kb.load_current_bundle(domain, pattern)
        versions = self.kb.get_current_versions(domain, pattern)
        return RuntimeLookup(
            domain=domain,
            url=url,
            url_pattern=pattern,
            bundle=bundle,
            workflow_version=versions.get("workflow_version"),
            prompt_version=versions.get("prompt_version"),
        )

    def execute_stub(self, *, domain: str, url: str, intent: str) -> dict[str, Any]:
        """Simulate one runtime execution and log versioned run metadata.

        This is a stub for integration wiring until full executor binding
        is connected to DSL/macros.
        """
        lookup = self.resolve(domain=domain, url=url)
        parsed = urlparse(url)
        fallback_pattern = parsed.path or "/"

        if lookup.bundle is None or lookup.url_pattern is None:
            self.kb.append_run(
                domain=domain,
                url_pattern=fallback_pattern,
                payload={
                    "status": "miss",
                    "intent": intent,
                    "bundle_version": None,
                    "prompt_version": None,
                    "reason": "bundle_not_found",
                },
            )
            return {
                "status": "miss",
                "bundle_version": None,
                "prompt_version": None,
            }

        self.kb.append_run(
            domain=domain,
            url_pattern=lookup.url_pattern,
            payload={
                "status": "ok",
                "intent": intent,
                "bundle_version": lookup.workflow_version,
                "prompt_version": lookup.prompt_version,
                "strategy": getattr(lookup.bundle, "strategy", None),
            },
        )
        return {
            "status": "ok",
            "bundle_version": lookup.workflow_version,
            "prompt_version": lookup.prompt_version,
            "strategy": getattr(lookup.bundle, "strategy", None),
        }

    def execute_or_generate_stub(
        self,
        *,
        domain: str,
        url: str,
        intent: str,
        profile: SiteProfile,
        codegen_agent: ICodeGenAgent | CodeGenAgent,
        validator: CodeValidator | None = None,
        promotion_gate: IPromotionGate | PromotionGate | None = None,
    ) -> dict[str, Any]:
        """Execute if bundle exists; otherwise generate + save + log."""
        lookup = self.resolve(domain=domain, url=url)
        if lookup.bundle is not None and lookup.url_pattern is not None:
            return self.execute_stub(domain=domain, url=url, intent=intent)

        runtime_stats = self.kb.get_strategy_runtime_stats(
            domain=domain,
            url_pattern=str(profile.url_pattern or ""),
        )
        generated = self._generate_bundle_with_optional_runtime_stats(
            codegen_agent=codegen_agent,
            profile=profile,
            url=url,
            intent=intent,
            runtime_stats=runtime_stats,
        )
        if validator is not None:
            v = validator.validate_bundle(bundle=generated, profile=profile, intent=intent)
            if not v.overall:
                self.kb.append_run(
                    domain=domain,
                    url_pattern=str(profile.url_pattern or "/"),
                    payload={
                        "status": "generation_failed",
                        "intent": intent,
                        "bundle_version": None,
                        "prompt_version": None,
                        "errors": v.errors,
                        "strategy": generated.strategy,
                    },
                )
                return {
                    "status": "generation_failed",
                    "bundle_version": None,
                    "prompt_version": None,
                    "errors": v.errors,
                    "strategy": generated.strategy,
                }

        if promotion_gate is not None:
            decision = promotion_gate.evaluate_bundle(
                bundle=generated,
                profile=profile,
                intent=intent,
            )
            overall = bool(getattr(decision, "overall", False))
            if not overall:
                replay_ok = bool(getattr(decision, "replay_ok", False))
                canary_ok = bool(getattr(decision, "canary_ok", False))
                issues = list(getattr(decision, "issues", []))
                replay_pass_rate = float(getattr(decision, "replay_pass_rate", 0.0))
                canary_pass_rate = float(getattr(decision, "canary_pass_rate", 0.0))
                self.kb.append_run(
                    domain=domain,
                    url_pattern=str(generated.workflow_dsl["url_pattern"]),
                    payload={
                        "status": "promotion_blocked",
                        "intent": intent,
                        "bundle_version": None,
                        "prompt_version": None,
                        "replay_ok": replay_ok,
                        "canary_ok": canary_ok,
                        "replay_pass_rate": replay_pass_rate,
                        "canary_pass_rate": canary_pass_rate,
                        "issues": issues,
                        "strategy": generated.strategy,
                    },
                )
                return {
                    "status": "promotion_blocked",
                    "bundle_version": None,
                    "prompt_version": None,
                    "replay_ok": replay_ok,
                    "canary_ok": canary_ok,
                    "replay_pass_rate": replay_pass_rate,
                    "canary_pass_rate": canary_pass_rate,
                    "issues": issues,
                    "strategy": generated.strategy,
                }

        version = self.kb.save_bundle(domain, generated.workflow_dsl["url_pattern"], generated)

        self.kb.append_run(
            domain=domain,
            url_pattern=str(generated.workflow_dsl["url_pattern"]),
            payload={
                "status": "generated",
                "intent": intent,
                "bundle_version": version,
                "prompt_version": version,
                "strategy": generated.strategy,
            },
        )
        return {
            "status": "generated",
            "bundle_version": version,
            "prompt_version": version,
            "strategy": generated.strategy,
        }

    def handle_failure_stub(
        self,
        *,
        domain: str,
        url_pattern: str,
        intent: str,
        error: str,
        verify_code: str | None,
    ) -> dict[str, Any]:
        """Classify failure and derive next remediation action."""
        cls = self.failure_analyzer.classify(error=error, verify_code=verify_code)
        plan = self.self_improver.plan_remediation(classification=cls)

        self.kb.append_run(
            domain=domain,
            url_pattern=url_pattern,
            payload={
                "status": "failed",
                "intent": intent,
                "error": error,
                "verify_code": verify_code,
                "failure_category": cls.category,
                "recommended_action": cls.recommended_action,
                "requires_human": plan.requires_human,
            },
        )
        return {
            "classification": {
                "category": cls.category,
                "reason": cls.reason,
                "recommended_action": cls.recommended_action,
                "confidence": cls.confidence,
            },
            "plan": {
                "action": plan.action,
                "requires_human": plan.requires_human,
                "steps": plan.steps,
            },
        }

    def detect_change_stub(
        self,
        *,
        domain: str,
        url_pattern: str,
        detector: ChangeDetector,
        selector_survival_rate: float,
        ax_diff_ratio: float,
        api_schema_diff_ratio: float,
        dead_selectors: list[str],
    ) -> dict[str, Any]:
        """Run change detector and log result to runs history."""
        report = detector.evaluate(
            selector_survival_rate=selector_survival_rate,
            ax_diff_ratio=ax_diff_ratio,
            api_schema_diff_ratio=api_schema_diff_ratio,
            dead_selectors=dead_selectors,
        )
        self.kb.append_run(
            domain=domain,
            url_pattern=url_pattern,
            payload={
                "status": "change_check",
                "change_changed": report.changed,
                "change_reason": report.reason,
                "change_score": report.change_score,
                "selector_survival_rate": report.selector_survival_rate,
                "ax_diff_ratio": report.ax_diff_ratio,
                "api_schema_diff_ratio": report.api_schema_diff_ratio,
                "dead_selectors": report.dead_selectors,
            },
        )
        return {
            "changed": report.changed,
            "reason": report.reason,
            "change_score": report.change_score,
        }

    def execute_workflow_stub(
        self,
        *,
        domain: str,
        url: str,
        intent: str,
        runner: IWorkflowStepRunner | None = None,
        max_steps: int = 50,
    ) -> dict[str, Any]:
        """Run workflow DSL steps with deterministic step-by-step tracing."""
        lookup = self.resolve(domain=domain, url=url)
        parsed = urlparse(url)
        fallback_pattern = parsed.path or "/"

        if lookup.bundle is None or lookup.url_pattern is None:
            self.kb.append_run(
                domain=domain,
                url_pattern=fallback_pattern,
                payload={
                    "status": "miss",
                    "intent": intent,
                    "bundle_version": None,
                    "prompt_version": None,
                    "reason": "bundle_not_found",
                },
            )
            return {
                "status": "miss",
                "bundle_version": None,
                "prompt_version": None,
            }

        steps = lookup.bundle.workflow_dsl.get("steps", [])
        strategy = getattr(lookup.bundle, "strategy", None)
        if not isinstance(steps, list):
            steps = []
        if len(steps) > max_steps:
            self.kb.append_run(
                domain=domain,
                url_pattern=lookup.url_pattern,
                payload={
                    "status": "failed",
                    "intent": intent,
                    "bundle_version": lookup.workflow_version,
                    "prompt_version": lookup.prompt_version,
                    "error": "workflow step limit exceeded",
                    "failed_step": "preflight",
                    "failure_category": "runtime",
                    "recommended_action": "full_recon",
                    "strategy": strategy,
                },
            )
            return {
                "status": "failed",
                "failed_step": "preflight",
                "failure_category": "runtime",
                "recommended_action": "full_recon",
                "bundle_version": lookup.workflow_version,
                "prompt_version": lookup.prompt_version,
                "strategy": strategy,
            }

        step_runner = runner or DeterministicStepRunner()
        context: dict[str, Any] = {}

        for idx, step in enumerate(steps, start=1):
            step_id = str(step.get("id") or f"step_{idx}")
            step_action = str(step.get("action") or "")
            result = step_runner.run_step(step=step, context=context)

            self.kb.append_run(
                domain=domain,
                url_pattern=lookup.url_pattern,
                payload={
                    "status": "step",
                    "intent": intent,
                    "bundle_version": lookup.workflow_version,
                    "prompt_version": lookup.prompt_version,
                    "step_index": idx,
                    "step_id": step_id,
                    "step_action": step_action,
                    "step_ok": result.ok,
                    "step_evidence": result.evidence or {},
                    "strategy": strategy,
                },
            )

            if result.ok:
                continue

            err = result.error or "unknown step execution error"
            cls = self.failure_analyzer.classify(error=err, verify_code=result.verify_code)
            plan = self.self_improver.plan_remediation(classification=cls)
            self.kb.append_run(
                domain=domain,
                url_pattern=lookup.url_pattern,
                payload={
                    "status": "failed",
                    "intent": intent,
                    "bundle_version": lookup.workflow_version,
                    "prompt_version": lookup.prompt_version,
                    "failed_step": step_id,
                    "error": err,
                    "verify_code": result.verify_code,
                    "failure_category": cls.category,
                    "recommended_action": cls.recommended_action,
                    "requires_human": plan.requires_human,
                    "strategy": strategy,
                },
            )
            return {
                "status": "failed",
                "failed_step": step_id,
                "error": err,
                "failure_category": cls.category,
                "recommended_action": cls.recommended_action,
                "bundle_version": lookup.workflow_version,
                "prompt_version": lookup.prompt_version,
                "strategy": strategy,
            }

        self.kb.append_run(
            domain=domain,
            url_pattern=lookup.url_pattern,
            payload={
                "status": "executed",
                "intent": intent,
                "bundle_version": lookup.workflow_version,
                "prompt_version": lookup.prompt_version,
                "executed_steps": len(steps),
                "context_keys": sorted(context.keys()),
                "strategy": strategy,
            },
        )
        return {
            "status": "executed",
            "executed_steps": len(steps),
            "bundle_version": lookup.workflow_version,
            "prompt_version": lookup.prompt_version,
            "strategy": strategy,
        }

    def execute_with_recovery_stub(
        self,
        *,
        domain: str,
        url: str,
        intent: str,
        runner: IWorkflowStepRunner | None = None,
        max_attempts: int = 3,
        max_steps: int = 50,
    ) -> dict[str, Any]:
        """Execute workflow with deterministic retry/handoff policy."""
        attempts = max(1, max_attempts)
        final_result: dict[str, Any] | None = None
        lookup = self.resolve(domain=domain, url=url)
        parsed = urlparse(url)
        fallback_pattern = parsed.path or "/"
        run_pattern = lookup.url_pattern or fallback_pattern
        bundle_version = lookup.workflow_version
        prompt_version = lookup.prompt_version

        for attempt in range(1, attempts + 1):
            self.kb.append_run(
                domain=domain,
                url_pattern=run_pattern,
                payload={
                    "status": "recovery_attempt",
                    "intent": intent,
                    "attempt": attempt,
                    "max_attempts": attempts,
                    "bundle_version": bundle_version,
                    "prompt_version": prompt_version,
                },
            )
            out = self.execute_workflow_stub(
                domain=domain,
                url=url,
                intent=intent,
                runner=runner,
                max_steps=max_steps,
            )
            final_result = out

            if out.get("status") == "executed":
                recovered = attempt > 1
                self.kb.append_run(
                    domain=domain,
                    url_pattern=run_pattern,
                    payload={
                        "status": "recovery_completed",
                        "intent": intent,
                        "attempts": attempt,
                        "recovered": recovered,
                        "bundle_version": bundle_version,
                        "prompt_version": prompt_version,
                        "strategy": final_result.get("strategy"),
                    },
                )
                result = dict(out)
                result.update({"attempts": attempt, "recovered": recovered})
                return result

            if out.get("status") == "miss":
                self.kb.append_run(
                    domain=domain,
                    url_pattern=run_pattern,
                    payload={
                        "status": "recovery_failed",
                        "intent": intent,
                        "attempts": attempt,
                        "reason": "bundle_not_found",
                        "bundle_version": bundle_version,
                        "prompt_version": prompt_version,
                        "strategy": out.get("strategy"),
                    },
                )
                result = dict(out)
                result.update({"attempts": attempt, "recovered": False})
                return result

            category = str(out.get("failure_category") or "runtime")
            if category == "security":
                self.kb.append_run(
                    domain=domain,
                    url_pattern=run_pattern,
                    payload={
                        "status": "recovery_handoff",
                        "intent": intent,
                        "attempts": attempt,
                        "failure_category": category,
                        "requires_human": True,
                        "bundle_version": bundle_version,
                        "prompt_version": prompt_version,
                        "strategy": out.get("strategy"),
                    },
                )
                result = dict(out)
                result.update(
                    {
                        "attempts": attempt,
                        "recovered": False,
                        "requires_human": True,
                    }
                )
                return result

            is_retryable = category in self._RETRYABLE_FAILURE_CATEGORIES
            if attempt >= attempts or not is_retryable:
                self.kb.append_run(
                    domain=domain,
                    url_pattern=run_pattern,
                    payload={
                        "status": "recovery_failed",
                        "intent": intent,
                        "attempts": attempt,
                        "failure_category": category,
                        "retryable": is_retryable,
                        "bundle_version": bundle_version,
                        "prompt_version": prompt_version,
                        "strategy": out.get("strategy"),
                    },
                )
                result = dict(out)
                result.update(
                    {
                        "attempts": attempt,
                        "recovered": False,
                        "requires_human": False,
                    }
                )
                return result

            self.kb.append_run(
                domain=domain,
                url_pattern=run_pattern,
                payload={
                    "status": "recovery_retry_scheduled",
                    "intent": intent,
                    "attempt": attempt,
                    "next_attempt": attempt + 1,
                    "failure_category": category,
                    "recommended_action": out.get("recommended_action"),
                    "bundle_version": bundle_version,
                    "prompt_version": prompt_version,
                    "strategy": out.get("strategy"),
                },
            )

        if final_result is None:
            final_result = {"status": "failed", "failure_category": "runtime"}
        result = dict(final_result)
        result.update({"attempts": attempts, "recovered": False})
        return result

    def _generate_bundle_with_optional_runtime_stats(
        self,
        *,
        codegen_agent: ICodeGenAgent | CodeGenAgent,
        profile: SiteProfile,
        url: str,
        intent: str,
        runtime_stats: dict[str, dict[str, float | int]],
    ) -> Any:
        generate = codegen_agent.generate_bundle
        sig = inspect.signature(generate)
        if "runtime_stats" in sig.parameters:
            return generate(
                profile=profile,
                url=url,
                intent=intent,
                runtime_stats=runtime_stats,
            )
        return generate(profile=profile, url=url, intent=intent)
