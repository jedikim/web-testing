from src.recon.failure_analyzer import FailureClassification
from src.recon.models import GeneratedBundle
from src.recon.self_improver import RemediationPlan
from src.recon.workflow_patcher import WorkflowPatcher


def _bundle() -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={
            "schema_version": "1.0",
            "domain": "example.com",
            "url_pattern": "/search?query=*",
            "steps": [
                {
                    "id": "open",
                    "action": "goto",
                    "target": "https://example.com/search?q=tv",
                },
                {"id": "extract", "action": "extract_candidates", "target": "main"},
                {
                    "id": "verify",
                    "action": "verify_result",
                    "verify": {"kind": "dom_change_or_result_items", "min_items": 1},
                },
            ],
        },
        prompts={"extract": "x", "verify": "v"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_workflow_patcher_inserts_wait_before_failing_step() -> None:
    patcher = WorkflowPatcher()
    decision = patcher.patch_bundle(
        bundle=_bundle(),
        classification=FailureClassification(
            category="timing",
            reason="timeout",
            recommended_action="add_wait",
            confidence=0.9,
        ),
        plan=RemediationPlan(action="add_wait", requires_human=False),
        failed_step_id="extract",
    )

    assert decision.patched is True
    assert decision.reason == "add_wait"
    assert decision.bundle is not None

    steps = decision.bundle.workflow_dsl["steps"]
    actions = [s["action"] for s in steps]
    assert actions == ["goto", "wait", "extract_candidates", "verify_result"]


def test_workflow_patcher_adds_selector_recovery_params() -> None:
    patcher = WorkflowPatcher()
    decision = patcher.patch_bundle(
        bundle=_bundle(),
        classification=FailureClassification(
            category="selector",
            reason="selector missing",
            recommended_action="fix_selector",
            confidence=0.92,
        ),
        plan=RemediationPlan(action="fix_selector", requires_human=False),
        failed_step_id="extract",
    )

    assert decision.patched is True
    assert decision.bundle is not None
    extract_step = [
        s for s in decision.bundle.workflow_dsl["steps"] if s.get("id") == "extract"
    ][0]
    assert extract_step["params"]["selector_recovery"] == "semantic_fallback"


def test_workflow_patcher_skips_security_handoff() -> None:
    patcher = WorkflowPatcher()
    decision = patcher.patch_bundle(
        bundle=_bundle(),
        classification=FailureClassification(
            category="security",
            reason="captcha",
            recommended_action="human_handoff",
            confidence=0.99,
        ),
        plan=RemediationPlan(action="human_handoff", requires_human=True),
        failed_step_id="extract",
    )

    assert decision.patched is False
    assert decision.bundle is None
    assert decision.reason == "human_handoff"
