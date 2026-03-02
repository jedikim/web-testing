from datetime import UTC, datetime

from src.recon.agent import ReconAgent
from src.recon.knowledge_base import KnowledgeBase


class _DomScanner:
    async def scan(self, url: str) -> dict:
        return {
            "framework": "react",
            "is_spa": True,
            "url_pattern": "/search",
            "dom_hash": "dom-x",
            "ax_hash": "ax-x",
        }


class _VisualScanner:
    async def scan(self, url: str) -> dict:
        return {
            "content_types": ["product_list"],
            "repeating_patterns": ["product_card"],
            "obstacle_types": ["popup"],
        }


class _NavScanner:
    async def scan(self, url: str) -> dict:
        return {
            "navigation_hints": ["category", "search"],
            "interaction_hints": ["hover_menu"],
            "api_endpoints": ["/api/search"],
        }


async def test_recon_agent_builds_and_saves_profile(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    agent = ReconAgent(
        kb=kb,
        dom_scanner=_DomScanner(),
        visual_scanner=_VisualScanner(),
        nav_scanner=_NavScanner(),
    )

    profile = await agent.recon("https://example.com/search?q=tv")

    assert profile.domain == "example.com"
    assert profile.framework == "react"
    assert profile.recon_version == 1
    assert profile.created_at <= datetime.now(UTC)

    loaded = kb.load_profile("example.com")
    assert loaded is not None
    assert loaded.dom_hash == "dom-x"
