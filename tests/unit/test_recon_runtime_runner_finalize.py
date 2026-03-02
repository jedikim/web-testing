import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle
from src.recon.runtime import ReconRuntime, StepExecutionResult


class _ClosableRunner:
    def __init__(self) -> None:
        self.closed = False

    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        action = str(step.get("action") or "")
        if action == "extract_candidates":
            context["candidate_count"] = 2
        return StepExecutionResult(ok=True, evidence={"action": action})

    def close(self, *, context: dict) -> None:
        self.closed = True
        context["runner_closed"] = True


def _bundle() -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={
            "schema_version": "1.0",
            "domain": "example.com",
            "url_pattern": "/search?query=*",
            "steps": [
                {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
                {"id": "extract", "action": "extract_candidates", "target": "main"},
                {"id": "verify", "action": "verify_result", "verify": {"min_items": 1}},
            ],
        },
        prompts={"extract": "x", "verify": "v"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_execute_workflow_calls_runner_close(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle())
    runtime = ReconRuntime(kb)
    runner = _ClosableRunner()

    out = runtime.execute_workflow_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find tv",
        runner=runner,
    )

    assert out["status"] == "executed"
    assert runner.closed is True

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "executed"
