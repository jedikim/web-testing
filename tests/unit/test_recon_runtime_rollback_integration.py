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


def test_runtime_rollback_stub_rolls_back_and_logs(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))
    kb.save_bundle("example.com", "/search?query=*", _bundle("v2"))

    runtime = ReconRuntime(kb)
    out = runtime.rollback_bundle_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        target_version=1,
        reason="manual approval",
    )

    assert out["status"] == "rolled_back"
    assert out["from_version"] == 2
    assert out["to_version"] == 1

    loaded = kb.load_current_bundle("example.com", "/search?query=*")
    assert loaded is not None
    assert loaded.workflow_dsl["label"] == "v1"

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "rolled_back"


def test_runtime_rollback_stub_fails_on_missing_target(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))

    runtime = ReconRuntime(kb)
    out = runtime.rollback_bundle_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        target_version=9,
        reason="manual approval",
    )

    assert out["status"] == "rollback_failed"
    assert out["to_version"] == 9
