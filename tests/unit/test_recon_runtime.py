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


def test_runtime_execute_stub_logs_bundle_versions(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    version = kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))
    assert version == 1

    runtime = ReconRuntime(kb)
    result = runtime.execute_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
    )

    assert result["status"] == "ok"
    assert result["bundle_version"] == 1
    assert result["prompt_version"] == 1

    runs = (tmp_path / "example.com" / "history" / "runs.jsonl").read_text(encoding="utf-8")
    row = json.loads(runs.strip().splitlines()[-1])
    assert row["bundle_version"] == 1
    assert row["prompt_version"] == 1
    assert row["intent"] == "find cheapest tv"


def test_runtime_execute_stub_logs_cache_miss(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)

    result = runtime.execute_stub(
        domain="example.com",
        url="https://example.com/search?q=tv",
        intent="find cheapest tv",
    )

    assert result["status"] == "miss"
    assert result["bundle_version"] is None
