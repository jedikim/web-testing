from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import GeneratedBundle


def _bundle(label: str) -> GeneratedBundle:
    return GeneratedBundle(
        workflow_dsl={"label": label, "steps": [{"action": "click"}]},
        prompts={"extract": f"extract-{label}", "verify": f"verify-{label}"},
        strategy="dom_only",
        dependencies=["playwright"],
    )


def test_save_and_load_current_bundle(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    v1 = kb.save_bundle("example.com", "/search?query=*", _bundle("v1"))
    v2 = kb.save_bundle("example.com", "/search?query=*", _bundle("v2"))

    assert v1 == 1
    assert v2 == 2

    loaded = kb.load_current_bundle("example.com", "/search?query=*")
    assert loaded is not None
    assert loaded.workflow_dsl["label"] == "v2"


def test_match_url_to_pattern_dir(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    kb.save_bundle("example.com", "/search?query=*", _bundle("s"))
    kb.save_bundle("example.com", "/catalog/*", _bundle("c"))

    hit = kb.resolve_pattern_for_url("example.com", "https://example.com/search?q=tv")
    miss = kb.resolve_pattern_for_url("example.com", "https://example.com/unknown/path")

    assert hit == "/search?query=*"
    assert miss is None
