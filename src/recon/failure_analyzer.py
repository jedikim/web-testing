"""Failure classification for recon/runtime flow."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FailureClassification:
    category: str
    reason: str
    recommended_action: str
    confidence: float


class FailureAnalyzer:
    """Classify failures using deterministic layered rules."""

    _VERIFY_CODE_MAP = {
        "EXPECT_SELECTOR_MISSING": ("selector", "fix_selector", 0.95),
        "EXPECT_TIMEOUT": ("timing", "add_wait", 0.9),
        "EXPECT_RENDER_MISMATCH": ("rendering", "change_strategy", 0.85),
    }

    def classify(self, *, error: str, verify_code: str | None = None) -> FailureClassification:
        txt = (error or "").lower().strip()
        if verify_code and verify_code in self._VERIFY_CODE_MAP:
            c, a, conf = self._VERIFY_CODE_MAP[verify_code]
            return FailureClassification(c, f"verify_code:{verify_code}", a, conf)

        # 1) Security/human-handoff first.
        if any(k in txt for k in ("captcha", "2fa", "otp", "verification code")):
            return FailureClassification("security", "security challenge", "human_handoff", 0.99)

        # 2) Playwright error signatures.
        if any(k in txt for k in ("timeout", "timed out", "waiting for")):
            return FailureClassification("timing", "timeout signature", "add_wait", 0.92)
        if any(k in txt for k in ("selector", "not found", "strict mode violation")):
            return FailureClassification(
                "selector",
                "selector resolution failed",
                "fix_selector",
                0.9,
            )
        if any(k in txt for k in ("not visible", "intercepted", "not attached")):
            return FailureClassification("interaction", "interaction blocked", "fix_obstacle", 0.88)
        if any(k in txt for k in ("typeerror", "referenceerror", "cannot read properties")):
            return FailureClassification("runtime", "js/runtime exception", "full_recon", 0.86)
        if any(
            k in txt
            for k in ("empty data", "no rows", "nan", "invalid price", "schema mismatch")
        ):
            return FailureClassification("data", "data quality issue", "change_strategy", 0.8)
        if any(k in txt for k in ("render", "screenshot mismatch", "layout shift")):
            return FailureClassification("rendering", "render mismatch", "change_strategy", 0.78)

        return FailureClassification("runtime", "unclassified error", "full_recon", 0.55)
