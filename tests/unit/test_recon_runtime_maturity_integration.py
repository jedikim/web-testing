import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.runtime import ReconRuntime


def test_runtime_maturity_check_logs_stage_and_metrics(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    for _ in range(10):
        kb.append_run(
            domain="example.com",
            url_pattern="/search?query=*",
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 0},
        )

    runtime = ReconRuntime(kb)
    out = runtime.get_maturity_state_stub(domain="example.com")

    assert out["stage"] == "hot"
    assert out["total_runs"] == 10
    assert out["llm_calls_last_10"] == 0

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "maturity_check"
    assert rows[-1]["stage"] == "hot"
