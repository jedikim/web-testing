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


def test_runtime_health_summary_persists_snapshot(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"
    kb.save_bundle("example.com", pattern, _bundle("v1"))
    for _ in range(5):
        kb.append_run(
            domain="example.com",
            url_pattern=pattern,
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 0},
        )

    runtime = ReconRuntime(kb)
    out = runtime.get_domain_health_summary_stub(
        domain="example.com",
        url_pattern=pattern,
        failure_threshold=3,
    )

    latest = kb.load_latest_health_snapshot(domain="example.com")
    assert latest is not None
    assert latest["stage"] == out["stage"]
    assert latest["recommended_action"] == out["recommended_action"]
