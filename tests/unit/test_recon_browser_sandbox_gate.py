from src.recon.browser_sandbox_gate import BrowserCanaryEvaluator
from src.recon.models import GeneratedBundle
from src.recon.runtime import StepExecutionResult


class _FakeRunner:
    def __init__(self, *, fail_action: str | None = None, init_fail: bool = False) -> None:
        self.fail_action = fail_action
        self.init_fail = init_fail
        self.closed = False

    def run_step(self, *, step: dict, context: dict) -> StepExecutionResult:
        action = str(step.get("action") or "")
        if self.init_fail and action == "goto":
            return StepExecutionResult(ok=False, error="playwright init failed: missing browser")
        if self.fail_action and action == self.fail_action:
            return StepExecutionResult(ok=False, error=f"{action} failed")
        if action == "extract_candidates":
            context["candidate_count"] = 2
        return StepExecutionResult(ok=True, evidence={"action": action})

    def close(self, *, context: dict) -> None:
        self.closed = True


def _bundle(actions: list[str]) -> GeneratedBundle:
    steps: list[dict] = []
    for idx, action in enumerate(actions, start=1):
        step = {"id": f"s{idx}", "action": action}
        if action == "goto":
            step["target"] = "https://example.com"
        if action in {"click", "hover", "type", "select"}:
            step["target"] = "#btn"
        if action in {"type", "select"}:
            step["value"] = "x"
        if action == "verify_result":
            step["verify"] = {"min_items": 1}
        steps.append(step)
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


def test_browser_canary_evaluator_passes_with_fake_runner() -> None:
    runner = _FakeRunner()
    evaluator = BrowserCanaryEvaluator(runner_factory=lambda: runner)

    report = evaluator.evaluate_bundle(
        bundle=_bundle(["goto", "extract_candidates", "verify_result", "click", "type"])
    )

    assert report.ok is True
    assert report.skipped is False
    assert "click" in report.checked_actions
    assert runner.closed is True


def test_browser_canary_evaluator_reports_action_failure() -> None:
    evaluator = BrowserCanaryEvaluator(runner_factory=lambda: _FakeRunner(fail_action="click"))

    report = evaluator.evaluate_bundle(bundle=_bundle(["goto", "click", "verify_result"]))

    assert report.ok is False
    assert report.skipped is False
    assert any("click" in issue for issue in report.issues)


def test_browser_canary_evaluator_reports_skipped_when_browser_unavailable() -> None:
    evaluator = BrowserCanaryEvaluator(runner_factory=lambda: _FakeRunner(init_fail=True))

    report = evaluator.evaluate_bundle(bundle=_bundle(["goto", "verify_result"]))

    assert report.ok is False
    assert report.skipped is True
    assert any("browser_canary_unavailable" in issue for issue in report.issues)
