from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.validator import CodeValidator


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


def test_validator_accepts_valid_bundle() -> None:
    bundle = GeneratedBundle(
        workflow_dsl={
            "schema_version": "1.0",
            "steps": [
                {"id": "s1", "action": "goto", "target": "https://example.com"},
                {"id": "s2", "action": "extract_candidates"},
            ],
        },
        prompts={"extract": "x", "verify": "y"},
        strategy="dom_only",
        dependencies=["playwright"],
    )

    result = CodeValidator().validate_bundle(bundle=bundle, profile=_profile(), intent="find tv")
    assert result.overall is True


def test_validator_rejects_invalid_dsl() -> None:
    bundle = GeneratedBundle(
        workflow_dsl={"schema_version": "1.0", "steps": []},
        prompts={"extract": "x"},
        strategy="dom_only",
        dependencies=["playwright"],
    )

    result = CodeValidator().validate_bundle(bundle=bundle, profile=_profile(), intent="find tv")
    assert result.overall is False
    assert result.dsl_ok is False
    assert any("steps" in e for e in result.errors)
