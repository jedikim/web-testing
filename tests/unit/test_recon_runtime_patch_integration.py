import json

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle
from src.recon.runtime import ReconRuntime


def _bundle() -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={
            "schema_version": "1.0",
            "domain": "example.com",
            "url_pattern": "/search?query=*",
            "steps": [
                {
                    "id": "open",
                    "action": "goto",
                    "target": "https://example.com/search?q=tv",
                },
                {"id": "extract", "action": "extract_candidates", "target": "main"},
                {
                    "id": "verify",
                    "action": "verify_result",
                    "verify": {"kind": "dom_change_or_result_items", "min_items": 1},
                },
            ],
        },
        prompts={"extract": "x", "verify": "v"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_runtime_applies_failure_patch_and_promotes_new_version(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    v1 = kb.save_bundle("example.com", "/search?query=*", _bundle())
    assert v1 == 1

    runtime = ReconRuntime(kb)
    out = runtime.apply_failure_patch_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        intent="find cheapest tv",
        error="TimeoutError: waiting for selector timed out",
        verify_code="EXPECT_TIMEOUT",
        failed_step_id="extract",
    )

    assert out["status"] == "patched"
    assert out["from_version"] == 1
    assert out["to_version"] == 2

    current = kb.load_current_bundle("example.com", "/search?query=*")
    assert current is not None
    actions = [s["action"] for s in current.workflow_dsl["steps"]]
    assert actions == ["goto", "wait", "extract_candidates", "verify_result"]

    rows = [
        json.loads(line)
        for line in (tmp_path / "example.com" / "history" / "runs.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
    ]
    assert rows[-1]["status"] == "patched"


def test_runtime_patch_skips_when_bundle_missing(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    out = runtime.apply_failure_patch_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        intent="find cheapest tv",
        error="TimeoutError",
        verify_code="EXPECT_TIMEOUT",
        failed_step_id="extract",
    )

    assert out["status"] == "patch_miss"
