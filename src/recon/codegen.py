"""DSL-first code generation for recon runtime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse

from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.scanners import pattern_dir_from_url_pattern


@dataclass(frozen=True)
class StrategyDecision:
    strategy: str
    reason: str


class CodeGenAgent:
    """Generate lightweight DSL bundles from a site profile and intent."""

    def generate_bundle(
        self,
        *,
        profile: SiteProfile,
        url: str,
        intent: str,
        runtime_stats: dict[str, dict[str, float | int]] | None = None,
    ) -> GeneratedBundle:
        decision = self._decide_strategy(
            profile=profile,
            intent=intent,
            runtime_stats=runtime_stats,
        )
        url_pattern = profile.url_pattern or self._url_pattern_from_url(url)
        workflow = self._build_workflow(
            profile=profile,
            url=url,
            url_pattern=url_pattern,
            intent=intent,
            strategy=decision.strategy,
        )
        prompts = self._build_prompts(profile=profile, intent=intent, strategy=decision.strategy)
        dependencies = ["playwright"]
        if decision.strategy in {"dom_with_objdet_backup", "objdet_dom_hybrid"}:
            dependencies.append("opencv-python")
        if decision.strategy in {"grid_vlm", "vlm_only"}:
            dependencies.append("google-genai")

        return GeneratedBundle(
            workflow_dsl=workflow,
            prompts=prompts,
            strategy=decision.strategy,
            dependencies=dependencies,
        )

    def _decide_strategy(
        self,
        *,
        profile: SiteProfile,
        intent: str,
        runtime_stats: dict[str, dict[str, float | int]] | None = None,
    ) -> StrategyDecision:
        intent_l = intent.lower()
        hints = {v.lower() for v in profile.interaction_hints}
        heuristic = StrategyDecision("dom_only", "default deterministic strategy")

        visual_keywords = {
            "image",
            "thumbnail",
            "color",
            "red",
            "visual",
            "사진",
            "이미지",
            "썸네일",
            "색상",
            "붉은",
        }
        if any(k in intent_l for k in visual_keywords):
            if profile.content_types and "product_list" in profile.content_types:
                heuristic = StrategyDecision("grid_vlm", "visual intent + list page")
            else:
                heuristic = StrategyDecision("vlm_only", "visual intent")
            return self._apply_runtime_override(default=heuristic, runtime_stats=runtime_stats)

        if "drag_control" in hints:
            heuristic = StrategyDecision("objdet_dom_hybrid", "drag interaction hints present")
            return self._apply_runtime_override(default=heuristic, runtime_stats=runtime_stats)

        if (
            "product_list" in profile.content_types
            or len(profile.repeating_patterns) >= 1
        ):
            heuristic = StrategyDecision("dom_with_objdet_backup", "repeating list/content signals")
            return self._apply_runtime_override(default=heuristic, runtime_stats=runtime_stats)

        return self._apply_runtime_override(default=heuristic, runtime_stats=runtime_stats)

    def _apply_runtime_override(
        self,
        *,
        default: StrategyDecision,
        runtime_stats: dict[str, dict[str, float | int]] | None,
    ) -> StrategyDecision:
        if not runtime_stats:
            return default

        max_runs = 0
        for values in runtime_stats.values():
            raw_runs = values.get("runs", 0)
            if isinstance(raw_runs, int):
                max_runs = max(max_runs, raw_runs)
        if max_runs < 3:
            return default

        default_score = self._strategy_perf_score(default.strategy, runtime_stats)
        best_strategy = default.strategy
        best_score = default_score
        for strategy in (
            "dom_only",
            "dom_with_objdet_backup",
            "objdet_dom_hybrid",
            "grid_vlm",
            "vlm_only",
        ):
            score = self._strategy_perf_score(strategy, runtime_stats)
            if score > best_score:
                best_strategy = strategy
                best_score = score

        if best_strategy == default.strategy:
            return default
        if best_score - default_score < 0.20:
            return default
        return StrategyDecision(best_strategy, "runtime_stats_override")

    @staticmethod
    def _strategy_perf_score(
        strategy: str,
        runtime_stats: dict[str, dict[str, float | int]],
    ) -> float:
        stats = runtime_stats.get(strategy, {})
        success = float(stats.get("success_rate", 0.5))
        avg_cost = float(stats.get("avg_cost", 0.003))
        p95_latency_ms = float(stats.get("p95_latency_ms", 3000))
        return (success * 1.5) - (avg_cost * 40.0) - (p95_latency_ms / 10000.0)

    def _build_workflow(
        self,
        *,
        profile: SiteProfile,
        url: str,
        url_pattern: str,
        intent: str,
        strategy: str,
    ) -> dict[str, Any]:
        steps: list[dict[str, Any]] = [
            {
                "id": "open",
                "action": "goto",
                "target": url,
            },
            {
                "id": "prepare",
                "action": "capture_dom",
                "target": "document",
                "verify": {"kind": "url_contains_domain", "value": profile.domain},
            },
            {
                "id": "extract",
                "action": "extract_candidates",
                "target": "main",
                "params": {
                    "intent": intent,
                    "strategy": strategy,
                    "navigation_hints": profile.navigation_hints,
                    "interaction_hints": profile.interaction_hints,
                },
            },
            {
                "id": "verify",
                "action": "verify_result",
                "verify": {
                    "kind": "dom_change_or_result_items",
                    "min_items": 1,
                },
            },
        ]

        return {
            "schema_version": "1.0",
            "domain": profile.domain,
            "url_pattern": url_pattern,
            "pattern_dir": pattern_dir_from_url_pattern(url_pattern),
            "strategy": strategy,
            "intent_template": intent,
            "steps": steps,
        }

    def _build_prompts(self, *, profile: SiteProfile, intent: str, strategy: str) -> dict[str, str]:
        return {
            "extract": (
                "Extract actionable candidates from reduced DOM candidates only. "
                f"Domain={profile.domain}, strategy={strategy}, intent={intent}"
            ),
            "navigate": (
                "Prefer hierarchy traversal before broad search. "
                f"Hints={','.join(profile.navigation_hints) or 'none'}"
            ),
            "verify": (
                "Verify-after-act: URL change, DOM assertions, and result relevance checks. "
                "Do not claim success without evidence."
            ),
            "fallback": (
                "On failure: classify timing/selector/interaction/data/runtime/rendering and "
                "return patch-only recommendation."
            ),
        }

    def _url_pattern_from_url(self, url: str) -> str:
        parsed = urlparse(url)
        path = parsed.path or "/"
        if parsed.query:
            return f"{path}?query=*"
        return path
