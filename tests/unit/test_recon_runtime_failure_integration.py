import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.runtime import ReconRuntime


def test_runtime_failure_flow_logs_classification_and_plan(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    out = runtime.handle_failure_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        intent="find cheapest tv",
        error="TimeoutError: waiting for selector timed out",
        verify_code=None,
    )

    assert out["classification"]["category"] == "timing"
    assert out["plan"]["action"] == "add_wait"

    runs = (tmp_path / "example.com" / "history" / "runs.jsonl").read_text(encoding="utf-8")
    row = json.loads(runs.strip().splitlines()[-1])
    assert row["status"] == "failed"
    assert row["failure_category"] == "timing"
