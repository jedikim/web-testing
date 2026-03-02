from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle


def _bundle(label: str) -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={"label": label, "steps": [{"action": "click"}]},
        prompts={"extract": f"extract-{label}", "verify": f"verify-{label}"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_kb_lists_bundle_versions_sorted(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))
    kb.save_bundle("example.com", "/search?query=*", _bundle("v2"))
    kb.save_bundle("example.com", "/search?query=*", _bundle("v3"))

    versions = kb.list_bundle_versions(domain="example.com", url_pattern="/search?query=*")

    assert versions == [1, 2, 3]


def test_kb_consecutive_failures_stops_at_last_success(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    pattern = "/search?query=*"

    kb.append_run(
        domain="example.com",
        url_pattern=pattern,
        payload={"status": "failed", "strategy": "dom_only"},
    )
    kb.append_run(
        domain="example.com",
        url_pattern=pattern,
        payload={"status": "executed", "strategy": "dom_only"},
    )
    kb.append_run(
        domain="example.com",
        url_pattern=pattern,
        payload={"status": "failed", "strategy": "dom_only"},
    )
    kb.append_run(
        domain="example.com",
        url_pattern=pattern,
        payload={"status": "failed", "strategy": "dom_only"},
    )

    count = kb.get_consecutive_failures(domain="example.com", url_pattern=pattern)

    assert count == 2
