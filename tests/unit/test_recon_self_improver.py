from src.recon.failure_analyzer import FailureClassification
from src.recon.self_improver import SelfImprover


def test_self_improver_builds_selector_patch_plan() -> None:
    improver = SelfImprover()
    c = FailureClassification(
        category="selector",
        reason="selector not found",
        recommended_action="fix_selector",
        confidence=0.92,
    )
    plan = improver.plan_remediation(classification=c)
    assert plan.action == "fix_selector"
    assert plan.requires_human is False


def test_self_improver_security_requires_human() -> None:
    improver = SelfImprover()
    c = FailureClassification(
        category="security",
        reason="captcha detected",
        recommended_action="human_handoff",
        confidence=0.99,
    )
    plan = improver.plan_remediation(classification=c)
    assert plan.requires_human is True
    assert plan.action == "human_handoff"
