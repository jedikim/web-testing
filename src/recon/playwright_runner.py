"""Playwright-backed workflow step runner for recon runtime."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class StepExecutionResult:
    ok: bool
    error: str | None = None
    verify_code: str | None = None
    evidence: dict[str, Any] | None = None


class PlaywrightStepRunner:
    """Execute workflow steps against a real browser page using Playwright sync API.

    The runner keeps browser/page objects in the shared runtime context and cleans them
    up via `close(context)`.
    """

    def __init__(self, *, headless: bool = True, timeout_ms: int = 5000) -> None:
        self.headless = headless
        self.timeout_ms = max(500, timeout_ms)

    def run_step(self, *, step: dict[str, Any], context: dict[str, Any]) -> StepExecutionResult:
        action = str(step.get("action") or "").strip()
        if not action:
            return StepExecutionResult(ok=False, error="missing action")

        try:
            page = self._ensure_page(context)
        except Exception as exc:  # pragma: no cover - environment dependent
            return StepExecutionResult(ok=False, error=f"playwright init failed: {exc}")

        try:
            if action == "goto":
                target = str(step.get("target") or "").strip()
                if not target:
                    return StepExecutionResult(ok=False, error="missing target for goto")
                page.goto(target, timeout=self.timeout_ms, wait_until="domcontentloaded")
                context["current_url"] = page.url
                return StepExecutionResult(ok=True, evidence={"url": page.url})

            if action == "capture_dom":
                html = page.content()
                context["dom_captured"] = True
                context["dom_size"] = len(html)
                return StepExecutionResult(
                    ok=True,
                    evidence={"dom_captured": True, "dom_size": len(html)},
                )

            if action == "extract_candidates":
                selector = self._resolve_selector(step)
                if selector:
                    count = page.locator(selector).count()
                else:
                    count = page.locator("article, li, [role='listitem'], .item, .product").count()
                context["candidate_count"] = int(count)
                return StepExecutionResult(
                    ok=True,
                    evidence={"candidate_count": int(count), "selector": selector or "auto"},
                )

            if action == "verify_result":
                verify = step.get("verify") if isinstance(step.get("verify"), dict) else {}
                min_items = int(verify.get("min_items", 1))
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

            if action == "click":
                selector = self._resolve_selector(step)
                if not selector:
                    return StepExecutionResult(ok=False, error="click requires target/selector")
                page.locator(selector).first.click(timeout=self.timeout_ms)
                return StepExecutionResult(ok=True, evidence={"selector": selector})

            if action in {"type", "select"}:
                selector = self._resolve_selector(step)
                value = str(step.get("value") or "")
                if not selector:
                    return StepExecutionResult(ok=False, error=f"{action} requires target/selector")
                page.locator(selector).first.fill(value, timeout=self.timeout_ms)
                return StepExecutionResult(ok=True, evidence={"selector": selector, "value": value})

            if action == "hover":
                selector = self._resolve_selector(step)
                if not selector:
                    return StepExecutionResult(ok=False, error="hover requires target/selector")
                page.locator(selector).first.hover(timeout=self.timeout_ms)
                return StepExecutionResult(ok=True, evidence={"selector": selector})

            if action == "scroll":
                params = step.get("params") if isinstance(step.get("params"), dict) else {}
                amount = int(params.get("amount", 400))
                page.evaluate("window.scrollBy(0, arguments[0])", amount)
                return StepExecutionResult(ok=True, evidence={"amount": amount})

            if action == "wait":
                params = step.get("params") if isinstance(step.get("params"), dict) else {}
                ms = int(params.get("ms", 800))
                page.wait_for_timeout(ms)
                return StepExecutionResult(ok=True, evidence={"ms": ms})

            return StepExecutionResult(ok=False, error=f"unknown action: {action}")
        except Exception as exc:  # pragma: no cover - browser/runtime dependent
            text = str(exc).lower()
            if "timeout" in text:
                return StepExecutionResult(ok=False, error=str(exc), verify_code="EXPECT_TIMEOUT")
            return StepExecutionResult(ok=False, error=str(exc))

    def close(self, *, context: dict[str, Any]) -> None:
        page = context.pop("_pw_page", None)
        browser = context.pop("_pw_browser", None)
        playwright = context.pop("_pw_playwright", None)
        for obj, method in ((page, "close"), (browser, "close"), (playwright, "stop")):
            if obj is None:
                continue
            try:
                getattr(obj, method)()
            except Exception:
                continue

    def _ensure_page(self, context: dict[str, Any]) -> Any:
        page = context.get("_pw_page")
        if page is not None:
            return page

        try:
            from playwright.sync_api import sync_playwright
        except Exception as exc:  # pragma: no cover - import environment dependent
            raise RuntimeError("playwright sync api unavailable") from exc

        pw = sync_playwright().start()
        browser = pw.chromium.launch(headless=self.headless)
        page = browser.new_page()
        context["_pw_playwright"] = pw
        context["_pw_browser"] = browser
        context["_pw_page"] = page
        return page

    @staticmethod
    def _resolve_selector(step: dict[str, Any]) -> str | None:
        params = step.get("params") if isinstance(step.get("params"), dict) else {}
        if isinstance(params.get("selector"), str) and params["selector"].strip():
            return str(params["selector"]).strip()
        target = step.get("target")
        if isinstance(target, str) and target.strip():
            return target.strip()
        return None
