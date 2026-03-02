from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.promotion_gate import PromotionGate


def _profile() -> SiteProfile:
    return SiteProfile(
        domain="example.com",
        purpose="ecommerce",
        language="ko",
        region="KR",
        framework="react",
        is_spa=True,
        url_pattern="/search?query=*",
        content_types=["product_list"],
        repeating_patterns=["DIV>ARTICLE*12"],
        obstacle_types=[],
        navigation_hints=["category", "search"],
        interaction_hints=[],
        api_endpoints=["/api/search"],
        dom_hash="dom-1",
        ax_hash="ax-1",
    )


def _bundle(*, with_verify_step: bool) -> GeneratedBundle:
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
    ]
    if with_verify_step:
        steps.append(
            {
                "id": "verify",
                "action": "verify_result",
                "verify": {"kind": "dom_change_or_result_items", "min_items": 1},
            }
        )

    return GeneratedBundle(
        workflow_dsl={
            "schema_version": "1.0",
            "domain": "example.com",
            "url_pattern": "/search?query=*",
            "steps": steps,
        },
        prompts={"extract": "x", "verify": "v"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_promotion_gate_accepts_minimal_valid_bundle() -> None:
    gate = PromotionGate()
    decision = gate.evaluate_bundle(
        bundle=_bundle(with_verify_step=True),
        profile=_profile(),
        intent="find cheapest tv",
    )

    assert decision.overall is True
    assert decision.replay_ok is True
    assert decision.canary_ok is True
    assert decision.issues == []


def test_promotion_gate_rejects_bundle_without_verify_step() -> None:
    gate = PromotionGate()
    decision = gate.evaluate_bundle(
        bundle=_bundle(with_verify_step=False),
        profile=_profile(),
        intent="find cheapest tv",
    )

    assert decision.overall is False
    assert decision.replay_ok is False
    assert any("verify_result" in issue for issue in decision.issues)
