"""Optional browser-sandbox canary checks for promotion gate."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

from src.recon.models import GeneratedBundle
from src.recon.playwright_runner import PlaywrightStepRunner


@dataclass(frozen=True)
class BrowserCanaryReport:
    ok: bool
    skipped: bool = False
    issues: list[str] = field(default_factory=list)
    checked_actions: list[str] = field(default_factory=list)


class BrowserCanaryEvaluator:
    """Runs lightweight browser action canary on a local fixture page.

    Goal: verify action semantics can execute in real browser context without
    touching external sites.
    """

    _ACTION_ORDER = [
        "goto",
        "capture_dom",
        "extract_candidates",
        "click",
        "type",
        "select",
        "hover",
        "scroll",
        "wait",
        "verify_result",
    ]
    _SANDBOX_HTML_URL = (
        "data:text/html,<html><body><button id='btn'>B</button>"
        "<input id='q'/><ul><li class='item'>A</li><li class='item'>B</li></ul>"
        "<div id='menu'>M</div></body></html>"
    )

    def __init__(
        self,
        *,
        runner_factory: Callable[[], Any] | None = None,
    ) -> None:
        self._runner_factory = runner_factory or (lambda: PlaywrightStepRunner(headless=True))

    def evaluate_bundle(self, *, bundle: GeneratedBundle) -> BrowserCanaryReport:
        actions = self._collect_supported_actions(bundle)
        if not actions:
            return BrowserCanaryReport(ok=True, skipped=True, checked_actions=[])

        runner = self._runner_factory()
        context: dict[str, Any] = {}
        issues: list[str] = []
        checked: list[str] = []

        steps = self._build_canary_steps(actions)
        for step in steps:
            out = runner.run_step(step=step, context=context)
            checked.append(str(step.get("action") or ""))
            if not out.ok:
                err = out.error or "unknown error"
                text = err.lower()
                if "playwright init failed" in text or "executable doesn't exist" in text:
                    self._close_runner(runner=runner, context=context)
                    return BrowserCanaryReport(
                        ok=False,
                        skipped=True,
                        issues=[f"browser_canary_unavailable: {err}"],
                        checked_actions=checked,
                    )
                issues.append(f"browser_canary:{step.get('action')}: {err}")

        self._close_runner(runner=runner, context=context)
        return BrowserCanaryReport(
            ok=len(issues) == 0,
            skipped=False,
            issues=issues,
            checked_actions=checked,
        )

    def _collect_supported_actions(self, bundle: GeneratedBundle) -> list[str]:
        raw_steps = bundle.workflow_dsl.get("steps")
        if not isinstance(raw_steps, list):
            return []
        actions = {
            str(step.get("action") or "").strip()
            for step in raw_steps
            if isinstance(step, dict) and step.get("action")
        }
        return [action for action in self._ACTION_ORDER if action in actions]

    @staticmethod
    def _build_canary_steps(actions: list[str]) -> list[dict[str, Any]]:
        if not actions:
            return []

        steps: list[dict[str, Any]] = [
            {
                "id": "sandbox_goto",
                "action": "goto",
                "target": BrowserCanaryEvaluator._SANDBOX_HTML_URL,
            }
        ]
        for action in actions:
            if action == "goto":
                continue
            if action == "capture_dom":
                steps.append({"id": "sandbox_capture", "action": "capture_dom"})
                continue
            if action == "extract_candidates":
                steps.append(
                    {
                        "id": "sandbox_extract",
                        "action": "extract_candidates",
                        "params": {"selector": "li.item"},
                    }
                )
                continue
            if action == "click":
                steps.append({"id": "sandbox_click", "action": "click", "target": "#btn"})
                continue
            if action in {"type", "select"}:
                steps.append(
                    {
                        "id": f"sandbox_{action}",
                        "action": action,
                        "target": "#q",
                        "value": "test",
                    }
                )
                continue
            if action == "hover":
                steps.append({"id": "sandbox_hover", "action": "hover", "target": "#menu"})
                continue
            if action == "scroll":
                steps.append(
                    {
                        "id": "sandbox_scroll",
                        "action": "scroll",
                        "params": {"amount": 200},
                    }
                )
                continue
            if action == "wait":
                steps.append({"id": "sandbox_wait", "action": "wait", "params": {"ms": 10}})
                continue
            if action == "verify_result":
                steps.append(
                    {
                        "id": "sandbox_verify",
                        "action": "verify_result",
                        "verify": {"min_items": 1},
                    }
                )
        return steps

    @staticmethod
    def _close_runner(*, runner: Any, context: dict[str, Any]) -> None:
        close = getattr(runner, "close", None)
        if close is None or not callable(close):
            return
        try:
            close(context=context)
        except Exception:
            return
