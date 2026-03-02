"""Knowledge Base storage for recon/codegen runtime."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from src.recon.models import SiteProfile


class KnowledgeBase:
    """File-system based KB with domain-level profiles and run logs."""

    def __init__(self, base_dir: str | Path = "sites") -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _domain_dir(self, domain: str) -> Path:
        return self.base_dir / domain

    def save_profile(self, profile: SiteProfile) -> None:
        """Save profile JSON/MD and append profile history snapshot."""
        domain_dir = self._domain_dir(profile.domain)
        domain_dir.mkdir(parents=True, exist_ok=True)

        (domain_dir / "profile.json").write_text(
            profile.model_dump_json(indent=2),
            encoding="utf-8",
        )
        (domain_dir / "profile.md").write_text(
            profile.to_markdown(),
            encoding="utf-8",
        )

        hist_dir = domain_dir / "profile_history"
        hist_dir.mkdir(parents=True, exist_ok=True)
        (hist_dir / f"v{profile.recon_version}.json").write_text(
            profile.model_dump_json(indent=2),
            encoding="utf-8",
        )

    def load_profile(self, domain: str) -> SiteProfile | None:
        """Load profile for a domain, if present."""
        profile_path = self._domain_dir(domain) / "profile.json"
        if not profile_path.exists():
            return None
        return SiteProfile.model_validate_json(profile_path.read_text(encoding="utf-8"))

    def append_run(self, domain: str, url_pattern: str, payload: dict[str, Any]) -> None:
        """Append one run event to history/runs.jsonl."""
        hist_dir = self._domain_dir(domain) / "history"
        hist_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "url_pattern": url_pattern,
            **payload,
        }
        with (hist_dir / "runs.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
