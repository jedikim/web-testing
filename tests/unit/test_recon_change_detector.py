from src.recon.change_detector import ChangeDetector


def test_major_restructure_by_change_score() -> None:
    detector = ChangeDetector()
    report = detector.evaluate(
        selector_survival_rate=0.6,  # (1-0.6)*0.5 = 0.2
        ax_diff_ratio=0.5,          # 0.15
        api_schema_diff_ratio=0.6,  # 0.12
        dead_selectors=[".item-card"],
    )

    assert report.changed is True
    assert report.reason == "major_restructure"
    assert report.change_score >= 0.45


def test_content_update_by_mid_score() -> None:
    detector = ChangeDetector()
    report = detector.evaluate(
        selector_survival_rate=0.85,
        ax_diff_ratio=0.25,
        api_schema_diff_ratio=0.3,
        dead_selectors=[".price"],
    )

    assert report.changed is True
    assert report.reason == "content_update"
    assert 0.20 <= report.change_score < 0.45


def test_no_change_when_score_low() -> None:
    detector = ChangeDetector()
    report = detector.evaluate(
        selector_survival_rate=0.98,
        ax_diff_ratio=0.02,
        api_schema_diff_ratio=0.01,
        dead_selectors=[],
    )

    assert report.changed is False
    assert report.reason is None
    assert report.change_score < 0.20
