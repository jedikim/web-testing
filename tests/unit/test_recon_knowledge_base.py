from datetime import UTC, datetime

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile


def _profile(domain: str = "example.com") -> SiteProfile:
    now = datetime.now(UTC)
    return SiteProfile(
        domain=domain,
        purpose="ecommerce",
        language="ko",
        region="KR",
        created_at=now,
        last_recon_at=now,
        recon_version=1,
        dom_hash="dom-1",
        ax_hash="ax-1",
        framework="react",
        is_spa=True,
        url_pattern="/search",
        content_types=["product_list"],
        repeating_patterns=["product_card"],
        obstacle_types=["cookie_banner"],
        navigation_hints=["category", "search"],
        interaction_hints=["hover_menu"],
        api_endpoints=["/api/search"],
    )


def test_profile_roundtrip(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    profile = _profile()

    kb.save_profile(profile)
    loaded = kb.load_profile("example.com")

    assert loaded is not None
    assert loaded.domain == profile.domain
    assert loaded.recon_version == 1


def test_append_run_history(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    kb.append_run(
        domain="example.com",
        url_pattern="search",
        payload={"status": "ok", "prompt_version": "v1"},
    )

    run_file = tmp_path / "example.com" / "history" / "runs.jsonl"
    assert run_file.exists()
    content = run_file.read_text(encoding="utf-8")
    assert "\"status\": \"ok\"" in content
