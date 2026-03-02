from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.runtime import ReconRuntime


class _StatsAwareCodegen:
    def __init__(self) -> None:
        self.seen_runtime_stats = None

    def generate_bundle(self, *, profile: SiteProfile, url: str, intent: str, runtime_stats=None):
        self.seen_runtime_stats = runtime_stats
        return GeneratedBundle(
            workflow_dsl={
                "schema_version": "1.0",
                "domain": profile.domain,
                "url_pattern": profile.url_pattern,
                "steps": [
                    {"id": "open", "action": "goto", "target": url},
                    {
                        "id": "verify",
                        "action": "verify_result",
                        "verify": {
                            "kind": "dom_change_or_result_items",
                            "min_items": 1,
                        },
                    },
                ],
            },
            prompts={"extract": "x", "verify": "v"},
            strategy="dom_only",
            dependencies=["playwright"],
        )


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


def test_runtime_passes_aggregated_stats_into_codegen(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.append_run(
        domain="example.com",
        url_pattern="/search?query=*",
        payload={
            "status": "executed",
            "strategy": "dom_only",
            "latency_ms": 900,
            "estimated_cost": 0.001,
        },
    )

    runtime = ReconRuntime(kb)
    codegen = _StatsAwareCodegen()

    out = runtime.execute_or_generate_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=codegen,
    )

    assert out["status"] == "generated"
    assert codegen.seen_runtime_stats is not None
    assert "dom_only" in codegen.seen_runtime_stats
