from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle


def _bundle(label: str) -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={"label": label, "steps": [{"action": "click"}]},
        prompts={"extract": f"extract-{label}", "verify": f"verify-{label}"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_kb_can_rollback_current_bundle_version(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))
    kb.save_bundle("example.com", "/search?query=*", _bundle("v2"))

    ok = kb.rollback_bundle(domain="example.com", url_pattern="/search?query=*", target_version=1)

    assert ok is True
    loaded = kb.load_current_bundle("example.com", "/search?query=*")
    assert loaded is not None
    assert loaded.workflow_dsl["label"] == "v1"

    versions = kb.get_current_versions("example.com", "/search?query=*")
    assert versions["workflow_version"] == 1
    assert versions["macro_version"] == 1
    assert versions["prompt_version"] == 1


def test_kb_rollback_returns_false_for_missing_target_version(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))

    ok = kb.rollback_bundle(domain="example.com", url_pattern="/search?query=*", target_version=3)

    assert ok is False
