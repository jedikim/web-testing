"""Site change detection based on weighted multi-signal scoring."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class ChangeReport:
    changed: bool
    reason: str | None = None
    dead_selectors: list[str] = field(default_factory=list)
    selector_survival_rate: float = 1.0
    ax_diff_ratio: float = 0.0
    api_schema_diff_ratio: float = 0.0
    change_score: float = 0.0


class ChangeDetector:
    """3-signal weighted detector for site structure/content changes.

    Score = (1 - selector_survival_rate)*0.5 + ax_diff_ratio*0.3 + api_diff*0.2
    """

    MAJOR_THRESHOLD = 0.45
    MINOR_THRESHOLD = 0.20
    SELECTOR_SURVIVAL_FLOOR = 0.70

    def evaluate(
        self,
        *,
        selector_survival_rate: float,
        ax_diff_ratio: float,
        api_schema_diff_ratio: float,
        dead_selectors: list[str] | None = None,
    ) -> ChangeReport:
        dead = dead_selectors or []
        score = (
            (1.0 - selector_survival_rate) * 0.5
            + ax_diff_ratio * 0.3
            + api_schema_diff_ratio * 0.2
        )

        if score >= self.MAJOR_THRESHOLD or selector_survival_rate < self.SELECTOR_SURVIVAL_FLOOR:
            return ChangeReport(
                changed=True,
                reason="major_restructure",
                dead_selectors=dead,
                selector_survival_rate=selector_survival_rate,
                ax_diff_ratio=ax_diff_ratio,
                api_schema_diff_ratio=api_schema_diff_ratio,
                change_score=score,
            )
        if score >= self.MINOR_THRESHOLD:
            return ChangeReport(
                changed=True,
                reason="content_update",
                dead_selectors=dead,
                selector_survival_rate=selector_survival_rate,
                ax_diff_ratio=ax_diff_ratio,
                api_schema_diff_ratio=api_schema_diff_ratio,
                change_score=score,
            )
        return ChangeReport(
            changed=False,
            reason=None,
            dead_selectors=dead,
            selector_survival_rate=selector_survival_rate,
            ax_diff_ratio=ax_diff_ratio,
            api_schema_diff_ratio=api_schema_diff_ratio,
            change_score=score,
        )
