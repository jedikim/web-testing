import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle
from src.recon.runtime import ReconRuntime, StepExecutionResult


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


def test_execute_workflow_stub_success_logs_step_trace(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "prepare", "action": "capture_dom", "target": "document"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
        {
            "id": "verify",
            "action": "verify_result",
            "verify": {"kind": "dom_change_or_result_items", "min_items": 1},
        },
    ]
    kb.save_bundle("example.com", "/search?query=*", _bundle(steps))

    runtime = ReconRuntime(kb)
    out = runtime.execute_workflow_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
    )

    assert out["status"] == "executed"
    assert out["executed_steps"] == 4

    runs_path = tmp_path / "example.com" / "history" / "runs.jsonl"
    rows = [json.loads(line) for line in runs_path.read_text(encoding="utf-8").splitlines()]
    step_rows = [r for r in rows if r["status"] == "step"]
    assert len(step_rows) == 4
    assert step_rows[0]["step_action"] == "goto"
    assert rows[-1]["status"] == "executed"


class _FailingRunner:
    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:  # pragma: no cover
        if step.get("id") == "extract":
            return StepExecutionResult(
                ok=False,
                error="simulated extraction failure",
                verify_code="EXPECT_TIMEOUT",
            )
        return StepExecutionResult(ok=True, evidence={"step": step.get("id")})


def test_execute_workflow_stub_failure_classifies_and_logs(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
    ]
    kb.save_bundle("example.com", "/search?query=*", _bundle(steps))

    runtime = ReconRuntime(kb)
    out = runtime.execute_workflow_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runner=_FailingRunner(),
    )

    assert out["status"] == "failed"
    assert out["failed_step"] == "extract"
    assert out["failure_category"] == "timing"
    assert out["recommended_action"] == "add_wait"

    runs_path = tmp_path / "example.com" / "history" / "runs.jsonl"
    rows = [json.loads(line) for line in runs_path.read_text(encoding="utf-8").splitlines()]
    assert rows[-1]["status"] == "failed"
    assert rows[-1]["failed_step"] == "extract"
    assert rows[-1]["failure_category"] == "timing"
