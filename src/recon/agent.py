"""Phase-1 Recon agent (lightweight implementation).

This intentionally starts with a simple async state flow and keeps scanner
interfaces swappable so LangGraph integration can be added without changing
storage/model contracts.
"""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol
from urllib.parse import urlparse

from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile


class IScanner(Protocol):
    async def scan(self, url: str) -> dict[str, object]: ...


@dataclass
class _NoopScanner:
    async def scan(self, url: str) -> dict[str, object]:
        del url
        return {}


class ReconAgent:
    """Build domain profile from DOM/visual/navigation scanners."""

    def __init__(
        self,
        kb: KnowledgeBase | None = None,
        dom_scanner: IScanner | None = None,
        visual_scanner: IScanner | None = None,
        nav_scanner: IScanner | None = None,
    ) -> None:
        self.kb = kb or KnowledgeBase()
        self.dom_scanner = dom_scanner or _NoopScanner()
        self.visual_scanner = visual_scanner or _NoopScanner()
        self.nav_scanner = nav_scanner or _NoopScanner()

    async def recon(
        self,
        url: str,
        *,
        purpose: str = "unknown",
        language: str = "unknown",
        region: str = "unknown",
    ) -> SiteProfile:
        """Run one recon pass and persist profile."""
        parsed = urlparse(url)
        domain = parsed.hostname or "unknown.local"
        now = datetime.now(UTC)

        dom_data, visual_data, nav_data = await asyncio.gather(
            self.dom_scanner.scan(url),
            self.visual_scanner.scan(url),
            self.nav_scanner.scan(url),
        )

        previous = self.kb.load_profile(domain)
        version = 1 if previous is None else previous.recon_version + 1

        dom_hash = str(dom_data.get("dom_hash") or _digest(dom_data))
        ax_hash = str(dom_data.get("ax_hash") or _digest({"ax": dom_data}))

        profile = SiteProfile(
            domain=domain,
            purpose=purpose,
            language=language,
            region=region,
            created_at=previous.created_at if previous is not None else now,
            last_recon_at=now,
            recon_version=version,
            dom_hash=dom_hash,
            ax_hash=ax_hash,
            framework=_as_str_or_none(dom_data.get("framework")),
            is_spa=bool(dom_data.get("is_spa", False)),
            url_pattern=_as_str(dom_data.get("url_pattern"), "/"),
            content_types=_as_str_list(visual_data.get("content_types")),
            repeating_patterns=_as_str_list(visual_data.get("repeating_patterns")),
            obstacle_types=_as_str_list(visual_data.get("obstacle_types")),
            navigation_hints=_as_str_list(nav_data.get("navigation_hints")),
            interaction_hints=_as_str_list(nav_data.get("interaction_hints")),
            api_endpoints=_as_str_list(nav_data.get("api_endpoints")),
        )
        self.kb.save_profile(profile)
        return profile


def _digest(data: object) -> str:
    encoded = repr(data).encode("utf-8")
    return hashlib.sha1(encoded).hexdigest()  # noqa: S324


def _as_str_or_none(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_str(value: object, default: str) -> str:
    if value is None:
        return default
    text = str(value).strip()
    return text or default


def _as_str_list(value: object) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v).strip() for v in value if str(v).strip()]
    text = str(value).strip()
    return [text] if text else []
