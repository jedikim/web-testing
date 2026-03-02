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


def test_guard_cycle_noop_when_rollback_not_needed(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))
    for _ in range(3):
        kb.append_run(
            domain="example.com",
            url_pattern=pattern,
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 0},
        )

    runtime = ReconRuntime(kb)
    out = runtime.run_continuous_guard_cycle_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    assert out["status"] == "guard_cycle_noop"
    assert out["summary"]["needs_auto_rollback"] is False

    rows = _rows(tmp_path)
    assert rows[-1]["status"] == "guard_cycle"
    assert rows[-1]["action"] == "no_op"


def test_guard_cycle_runs_auto_rollback_when_needed(tmp_path) -> None:
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
    out = runtime.run_continuous_guard_cycle_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    assert out["status"] == "guard_cycle_rollback"
    assert out["rollback"]["status"] == "auto_rolled_back"
    assert out["rollback"]["to_version"] == 1

    loaded = kb.load_current_bundle("example.com", pattern)
    assert loaded is not None
    assert loaded.workflow_dsl["label"] == "v1"

    rows = _rows(tmp_path)
    assert rows[-1]["status"] == "guard_cycle"
    assert rows[-1]["action"] == "auto_rollback"
