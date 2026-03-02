import json

from src.recon.codegen import CodeGenAgent
from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle, SiteProfile
from src.recon.runtime import ReconRuntime, StepExecutionResult


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


def _bundle(steps: list[dict]) -> GeneratedBundle:
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


class _NeedsWaitRunner:
    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        action = str(step.get("action") or "")
        if action == "wait":
            context["wait_seen"] = True
            return StepExecutionResult(ok=True, evidence={"wait": True})
        if action == "extract_candidates" and not context.get("wait_seen", False):
            return StepExecutionResult(
                ok=False,
                error="timed out while waiting for selector",
                verify_code="EXPECT_TIMEOUT",
            )
        if action == "verify_result":
            return StepExecutionResult(ok=True, evidence={"verified": True})
        return StepExecutionResult(ok=True, evidence={"action": action})


class _BlockingGate:
    class _Decision:
        overall = False
        replay_ok = False
        canary_ok = True
        issues = ["forced gate block"]
        replay_pass_rate = 0.0
        canary_pass_rate = 1.0

    def evaluate_bundle(self, *, bundle, profile, intent):
        _ = bundle, profile, intent
        return self._Decision()


def test_execute_adaptive_stub_direct_success_on_generated_bundle(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    out = runtime.execute_adaptive_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=CodeGenAgent(),
        max_attempts=1,
    )

    assert out["status"] == "executed"
    assert out["adaptive_status"] == "completed"
    assert out["path"] == "direct"
    assert out["patch_rounds"] == 0


def test_execute_adaptive_stub_patches_and_recovers(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    kb.save_bundle(
        "example.com",
        "/search?query=*",
        _bundle(
            [
                {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
                {"id": "extract", "action": "extract_candidates", "target": "main"},
                {"id": "verify", "action": "verify_result", "verify": {"min_items": 1}},
            ]
        ),
    )

    out = runtime.execute_adaptive_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=CodeGenAgent(),
        runner=_NeedsWaitRunner(),
        max_attempts=1,
        max_patch_rounds=2,
        max_regenerations=0,
    )

    assert out["status"] == "executed"
    assert out["adaptive_status"] == "completed"
    assert out["path"] == "patched"
    assert out["patch_rounds"] >= 1

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert any(row["status"] == "adaptive_patch_round" for row in rows)
    assert rows[-1]["status"] == "adaptive_completed"


def test_execute_adaptive_stub_returns_blocked_when_gate_rejects_generation(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    out = runtime.execute_adaptive_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        profile=_profile(),
        codegen_agent=CodeGenAgent(),
        promotion_gate=_BlockingGate(),
    )

    assert out["status"] == "promotion_blocked"
    assert out["adaptive_status"] == "blocked"
