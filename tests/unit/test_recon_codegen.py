from src.recon.codegen import CodeGenAgent
from src.recon.models import SiteProfile


def _profile(**kwargs):
    base = {
        "domain": "example.com",
        "purpose": "ecommerce",
        "language": "ko",
        "region": "KR",
        "framework": "react",
        "is_spa": True,
        "url_pattern": "/search?query=*",
        "content_types": ["product_list"],
        "repeating_patterns": ["DIV>ARTICLE*12"],
        "obstacle_types": [],
        "navigation_hints": ["category", "search"],
        "interaction_hints": [],
        "api_endpoints": ["/api/search"],
    }
    base.update(kwargs)
    return SiteProfile(**base)


def test_codegen_selects_dom_objdet_strategy_for_product_lists() -> None:
    agent = CodeGenAgent()
    profile = _profile()
    bundle = agent.generate_bundle(
        profile=profile,
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
    )

    assert bundle.strategy == "dom_with_objdet_backup"
    assert bundle.workflow_dsl["url_pattern"] == "/search?query=*"
    assert len(bundle.workflow_dsl["steps"]) >= 3


def test_codegen_selects_vlm_for_visual_intent() -> None:
    agent = CodeGenAgent()
    profile = _profile(content_types=["generic_page"], repeating_patterns=[])
    bundle = agent.generate_bundle(
        profile=profile,
        url="https://example.com",
        intent="find red product from image grid",
    )

    assert bundle.strategy in {"grid_vlm", "vlm_only"}
    assert "extract" in bundle.prompts
