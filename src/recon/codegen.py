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

    def generate_bundle(self, *, profile: SiteProfile, url: str, intent: str) -> GeneratedBundle:
        decision = self._decide_strategy(profile=profile, intent=intent)
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

    def _decide_strategy(self, *, profile: SiteProfile, intent: str) -> StrategyDecision:
        intent_l = intent.lower()
        hints = {v.lower() for v in profile.interaction_hints}

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
                return StrategyDecision("grid_vlm", "visual intent + list page")
            return StrategyDecision("vlm_only", "visual intent")

        if "drag_control" in hints:
            return StrategyDecision("objdet_dom_hybrid", "drag interaction hints present")

        if (
            "product_list" in profile.content_types
            or len(profile.repeating_patterns) >= 1
        ):
            return StrategyDecision("dom_with_objdet_backup", "repeating list/content signals")

        return StrategyDecision("dom_only", "default deterministic strategy")

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
