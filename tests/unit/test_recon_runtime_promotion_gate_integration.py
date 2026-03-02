import json

from src.recon.codegen import CodeGenAgent
from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile
from src.recon.runtime import ReconRuntime


class _BlockingGate:
    class _Decision:
        overall = False
        replay_ok = False
        canary_ok = True
        issues = ["replay gate blocked"]
        replay_pass_rate = 0.0
        canary_pass_rate = 1.0

    def evaluate_bundle(self, *, bundle, profile, intent):
        _ = bundle, profile, intent
        return self._Decision()


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


def test_runtime_blocks_promotion_when_gate_fails(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    out = runtime.execute_or_generate_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=CodeGenAgent(),
        promotion_gate=_BlockingGate(),
    )

    assert out["status"] == "promotion_blocked"
    assert out["bundle_version"] is None

    patterns_root = tmp_path / "example.com" / "url_patterns"
    assert not patterns_root.exists()

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "promotion_blocked"
