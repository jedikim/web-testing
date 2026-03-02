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


def _read_rows(tmp_path):
    return [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]


def test_runtime_auto_rollback_guard_triggers_on_threshold(tmp_path) -> None:
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
    out = runtime.auto_rollback_guard_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
        reason="auto guard",
    )

    assert out["status"] == "auto_rolled_back"
    assert out["from_version"] == 2
    assert out["to_version"] == 1
    assert out["consecutive_failures"] == 3

    loaded = kb.load_current_bundle("example.com", pattern)
    assert loaded is not None
    assert loaded.workflow_dsl["label"] == "v1"

    rows = _read_rows(tmp_path)
    assert rows[-1]["status"] == "auto_rolled_back"


def test_runtime_auto_rollback_guard_skips_below_threshold(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))
    kb.save_bundle("example.com", pattern, _bundle("v2"))

    kb.append_run(
        domain="example.com",
        url_pattern=pattern,
        payload={"status": "failed", "strategy": "dom_only", "bundle_version": 2},
    )

    runtime = ReconRuntime(kb)
    out = runtime.auto_rollback_guard_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
        reason="auto guard",
    )

    assert out["status"] == "auto_rollback_skipped"
    assert out["skip_reason"] == "threshold_not_met"


def test_runtime_auto_rollback_guard_skips_without_previous_version(tmp_path) -> None:
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
    out = runtime.auto_rollback_guard_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
        reason="auto guard",
    )

    assert out["status"] == "auto_rollback_skipped"
    assert out["skip_reason"] == "no_previous_version"
