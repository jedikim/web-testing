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


def test_codegen_can_override_heuristic_by_runtime_stats() -> None:
    agent = CodeGenAgent()
    profile = _profile()

    runtime_stats = {
        "dom_only": {
            "runs": 10,
            "success_rate": 0.95,
            "avg_cost": 0.0008,
            "p95_latency_ms": 900,
        },
        "dom_with_objdet_backup": {
            "runs": 10,
            "success_rate": 0.50,
            "avg_cost": 0.0030,
            "p95_latency_ms": 3000,
        },
    }

    bundle = agent.generate_bundle(
        profile=profile,
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runtime_stats=runtime_stats,
    )

    assert bundle.strategy == "dom_only"


def test_codegen_uses_heuristic_when_stats_insufficient() -> None:
    agent = CodeGenAgent()
    profile = _profile()

    runtime_stats = {
        "dom_only": {
            "runs": 1,
            "success_rate": 1.0,
            "avg_cost": 0.0001,
            "p95_latency_ms": 800,
        }
    }

    bundle = agent.generate_bundle(
        profile=profile,
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runtime_stats=runtime_stats,
    )

    assert bundle.strategy == "dom_with_objdet_backup"
