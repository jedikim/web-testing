import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle
from src.recon.runtime import ReconRuntime


def _bundle(label: str) -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={"label": label, "steps": [{"action": "click"}]},
        prompts={"extract": f"extract-{label}", "verify": f"verify-{label}"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def _rows(tmp_path):
    return [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]


def test_health_summary_requests_auto_rollback_when_guard_condition_met(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))
    kb.save_bundle("example.com", pattern, _bundle("v2"))

    for _ in range(3):
        kb.append_run(
            domain="example.com",
            url_pattern=pattern,
            payload={"status": "failed", "strategy": "dom_only", "bundle_version": 2},
        )

    runtime = ReconRuntime(kb)
    out = runtime.get_domain_health_summary_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    assert out["needs_auto_rollback"] is True
    assert out["recommended_action"] == "auto_rollback"
    assert out["current_version"] == 2
    assert out["consecutive_failures"] == 3

    rows = _rows(tmp_path)
    assert rows[-1]["status"] == "health_summary"
    assert rows[-1]["needs_auto_rollback"] is True


def test_health_summary_no_rollback_when_no_previous_version(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))

    for _ in range(3):
        kb.append_run(
            domain="example.com",
            url_pattern=pattern,
            payload={"status": "failed", "strategy": "dom_only", "bundle_version": 1},
        )

    runtime = ReconRuntime(kb)
    out = runtime.get_domain_health_summary_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    assert out["needs_auto_rollback"] is False
    assert out["has_previous_version"] is False
    assert out["recommended_action"] == "stabilize"


def test_health_summary_reports_hot_and_top_strategy(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))

    for _ in range(12):
        kb.append_run(
            domain="example.com",
            url_pattern=pattern,
            payload={
                "status": "executed",
                "strategy": "dom_only",
                "llm_calls": 0,
                "estimated_cost": 0.001,
                "latency_ms": 900,
            },
        )

    runtime = ReconRuntime(kb)
    out = runtime.get_domain_health_summary_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    assert out["stage"] == "hot"
    assert out["top_strategy"] == "dom_only"
    assert out["recommended_action"] == "keep_hot"
