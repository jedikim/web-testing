import json

from src.recon.codegen import CodeGenAgent
from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile
from src.recon.runtime import ReconRuntime


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


def test_runtime_generates_bundle_on_miss_and_logs_versions(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)
    codegen = CodeGenAgent()

    result = runtime.execute_or_generate_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=codegen,
    )

    assert result["status"] == "generated"
    assert result["bundle_version"] == 1
    assert result["prompt_version"] == 1

    runs = (tmp_path / "example.com" / "history" / "runs.jsonl").read_text(encoding="utf-8")
    row = json.loads(runs.strip().splitlines()[-1])
    assert row["status"] == "generated"
    assert row["bundle_version"] == 1
