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


class _FlakyTimingRunner:
    def __init__(self) -> None:
        self.fail_once = True

    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        if step.get("id") == "extract" and self.fail_once:
            self.fail_once = False
            return StepExecutionResult(
                ok=False,
                error="timed out while waiting for selector",
                verify_code="EXPECT_TIMEOUT",
            )
        return StepExecutionResult(ok=True, evidence={"step": step.get("id")})


class _SecurityRunner:
    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        if step.get("id") == "extract":
            return StepExecutionResult(ok=False, error="captcha required")
        return StepExecutionResult(ok=True, evidence={"step": step.get("id")})


class _AlwaysFailRunner:
    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        if step.get("id") == "extract":
            return StepExecutionResult(ok=False, error="timed out", verify_code="EXPECT_TIMEOUT")
        return StepExecutionResult(ok=True, evidence={"step": step.get("id")})


def test_recovery_retries_and_recovers_on_timing_failure(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
    ]
    kb.save_bundle("example.com", "/search?query=*", _bundle(steps))

    runtime = ReconRuntime(kb)
    out = runtime.execute_with_recovery_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runner=_FlakyTimingRunner(),
        max_attempts=3,
    )

    assert out["status"] == "executed"
    assert out["attempts"] == 2
    assert out["recovered"] is True

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    scheduled = [r for r in rows if r["status"] == "recovery_retry_scheduled"]
    assert len(scheduled) == 1
    assert rows[-1]["status"] == "recovery_completed"


def test_recovery_security_handoff_no_retry(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
    ]
    kb.save_bundle("example.com", "/search?query=*", _bundle(steps))

    runtime = ReconRuntime(kb)
    out = runtime.execute_with_recovery_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runner=_SecurityRunner(),
        max_attempts=3,
    )

    assert out["status"] == "failed"
    assert out["attempts"] == 1
    assert out["requires_human"] is True
    assert out["failure_category"] == "security"


def test_recovery_fails_after_max_attempts(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    steps = [
        {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
        {"id": "extract", "action": "extract_candidates", "target": "main"},
    ]
    kb.save_bundle("example.com", "/search?query=*", _bundle(steps))

    runtime = ReconRuntime(kb)
    out = runtime.execute_with_recovery_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
        runner=_AlwaysFailRunner(),
        max_attempts=2,
    )

    assert out["status"] == "failed"
    assert out["attempts"] == 2
    assert out["failure_category"] == "timing"

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "recovery_failed"
