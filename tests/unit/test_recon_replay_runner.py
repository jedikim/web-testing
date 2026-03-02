from src.recon.models import GeneratedBundle
from src.recon.replay_runner import ReplayCase, WorkflowReplayRunner


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


def test_replay_runner_passes_valid_workflow() -> None:
    runner = WorkflowReplayRunner()
    bundle = _bundle(
        [
            {"id": "open", "action": "goto", "target": "https://example.com/search?q=tv"},
            {"id": "extract", "action": "extract_candidates", "target": "main"},
            {
                "id": "verify",
                "action": "verify_result",
                "verify": {"kind": "dom_change_or_result_items", "min_items": 1},
            },
        ]
    )

    report = runner.run(
        bundle=bundle,
        cases=[
            ReplayCase(name="baseline", context={"candidate_count": 3}),
            ReplayCase(name="rich", context={"candidate_count": 20}),
        ],
    )

    assert report.total_cases == 2
    assert report.passed_cases == 2
    assert report.pass_rate == 1.0
    assert report.issues == []


def test_replay_runner_rejects_unknown_action() -> None:
    runner = WorkflowReplayRunner()
    bundle = _bundle(
        [
            {"id": "open", "action": "goto", "target": "https://example.com"},
            {"id": "boom", "action": "custom_hack"},
            {"id": "verify", "action": "verify_result", "verify": {"min_items": 1}},
        ]
    )

    report = runner.run(
        bundle=bundle,
        cases=[ReplayCase(name="baseline", context={"candidate_count": 3})],
    )

    assert report.passed_cases == 0
    assert any("unsupported action" in issue for issue in report.issues)


def test_replay_runner_fails_verify_when_candidates_too_low() -> None:
    runner = WorkflowReplayRunner()
    bundle = _bundle(
        [
            {"id": "open", "action": "goto", "target": "https://example.com"},
            {"id": "extract", "action": "extract_candidates", "target": "main"},
            {"id": "verify", "action": "verify_result", "verify": {"min_items": 5}},
        ]
    )

    report = runner.run(
        bundle=bundle,
        cases=[ReplayCase(name="low-candidate", context={"candidate_count": 2})],
    )

    assert report.passed_cases == 0
    assert any("verify_result failed" in issue for issue in report.issues)
