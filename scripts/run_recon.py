#!/usr/bin/env python3
"""Run a lightweight recon pass and persist SiteProfile.

Usage:
    python scripts/run_recon.py --url https://www.naver.com
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

_PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_PROJECT_ROOT))

from src.recon.agent import ReconAgent  # noqa: E402
from src.recon.knowledge_base import KnowledgeBase  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run recon and save site profile.")
    parser.add_argument("--url", required=True, help="Target URL")
    parser.add_argument("--purpose", default="unknown")
    parser.add_argument("--language", default="unknown")
    parser.add_argument("--region", default="unknown")
    parser.add_argument("--sites-dir", default="sites")
    return parser.parse_args()


async def _main() -> None:
    args = parse_args()
    kb = KnowledgeBase(base_dir=args.sites_dir)
    agent = ReconAgent(kb=kb)
    profile = await agent.recon(
        args.url,
        purpose=args.purpose,
        language=args.language,
        region=args.region,
    )
    print(json.dumps(profile.model_dump(mode="json"), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(_main())
