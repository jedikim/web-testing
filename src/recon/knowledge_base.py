"""Knowledge Base storage for recon/codegen runtime."""

from __future__ import annotations

import json
import math
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from src.recon.models import GeneratedBundle, MaturityState, SiteProfile
from src.recon.scanners import pattern_dir_from_url_pattern, serialize_prompt_map


class KnowledgeBase:
    """File-system based KB with domain-level profiles and run logs."""

    def __init__(self, base_dir: str | Path = "sites") -> None:
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _domain_dir(self, domain: str) -> Path:
        return self.base_dir / domain

    def _pattern_dir(self, domain: str, url_pattern: str) -> Path:
        return self._domain_dir(domain) / "url_patterns" / pattern_dir_from_url_pattern(url_pattern)

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

    def save_bundle(self, domain: str, url_pattern: str, bundle: GeneratedBundle) -> int:
        """Save a versioned generated bundle for a URL pattern.

        Returns:
            Saved version number.
        """
        pdir = self._pattern_dir(domain, url_pattern)
        pdir.mkdir(parents=True, exist_ok=True)
        (pdir / "pattern.json").write_text(
            json.dumps(
                {
                    "url_pattern": url_pattern,
                    "pattern_dir": pdir.name,
                    "updated_at": datetime.now(UTC).isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )

        workflows = pdir / "workflows"
        macros = pdir / "macros"
        prompts = pdir / "prompts"
        workflows.mkdir(parents=True, exist_ok=True)
        macros.mkdir(parents=True, exist_ok=True)
        prompts.mkdir(parents=True, exist_ok=True)

        version = self._next_pattern_version(workflows, ".dsl.json")

        # workflow dsl
        (workflows / f"v{version}.dsl.json").write_text(
            json.dumps(bundle.workflow_dsl, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (workflows / "current").write_text(f"v{version}", encoding="utf-8")

        # macros (optional)
        mv = macros / f"v{version}"
        mv.mkdir(parents=True, exist_ok=True)
        if bundle.python_macro:
            (mv / "macro.py").write_text(bundle.python_macro, encoding="utf-8")
        if bundle.ts_macro:
            (mv / "macro.ts").write_text(bundle.ts_macro, encoding="utf-8")
        (mv / "metadata.json").write_text(
            json.dumps(
                {
                    "strategy": bundle.strategy,
                    "dependencies": bundle.dependencies,
                    "created_at": bundle.created_at.isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (macros / "current").write_text(f"v{version}", encoding="utf-8")

        # prompts
        pv = prompts / f"v{version}"
        pv.mkdir(parents=True, exist_ok=True)
        prompt_map = serialize_prompt_map(bundle.prompts)
        for key, value in prompt_map.items():
            (pv / f"{key}.yaml").write_text(value, encoding="utf-8")
        (pv / "metadata.json").write_text(
            json.dumps(
                {
                    "version": version,
                    "strategy": bundle.strategy,
                    "created_at": bundle.created_at.isoformat(),
                },
                ensure_ascii=False,
                indent=2,
            ),
            encoding="utf-8",
        )
        (prompts / "current").write_text(f"v{version}", encoding="utf-8")

        return version

    def load_current_bundle(self, domain: str, url_pattern: str) -> GeneratedBundle | None:
        """Load current bundle for a URL pattern."""
        pdir = self._pattern_dir(domain, url_pattern)
        workflows = pdir / "workflows"
        macros = pdir / "macros"
        prompts = pdir / "prompts"
        if not workflows.exists():
            return None

        current = self._read_current_version(workflows)
        if current is None:
            return None

        dsl_path = workflows / f"v{current}.dsl.json"
        if not dsl_path.exists():
            return None

        workflow_dsl = json.loads(dsl_path.read_text(encoding="utf-8"))

        py_macro: str | None = None
        ts_macro: str | None = None
        macro_dir = macros / f"v{current}"
        if (macro_dir / "macro.py").exists():
            py_macro = (macro_dir / "macro.py").read_text(encoding="utf-8")
        if (macro_dir / "macro.ts").exists():
            ts_macro = (macro_dir / "macro.ts").read_text(encoding="utf-8")

        prompt_map: dict[str, str] = {}
        prompt_dir = prompts / f"v{current}"
        if prompt_dir.exists():
            for path in prompt_dir.glob("*.yaml"):
                prompt_map[path.stem] = path.read_text(encoding="utf-8")

        strategy = "dom_only"
        dependencies: list[str] = []
        meta = macro_dir / "metadata.json"
        if meta.exists():
            parsed = json.loads(meta.read_text(encoding="utf-8"))
            strategy = str(parsed.get("strategy", "dom_only"))
            dep_raw = parsed.get("dependencies", [])
            if isinstance(dep_raw, list):
                dependencies = [str(v) for v in dep_raw]

        return GeneratedBundle(
            workflow_dsl=workflow_dsl,
            python_macro=py_macro,
            ts_macro=ts_macro,
            prompts=prompt_map,
            strategy=strategy,
            dependencies=dependencies,
        )

    def get_current_versions(self, domain: str, url_pattern: str) -> dict[str, int | None]:
        """Return current artifact versions for a URL pattern."""
        pdir = self._pattern_dir(domain, url_pattern)
        return {
            "workflow_version": self._read_current_token(pdir / "workflows"),
            "macro_version": self._read_current_token(pdir / "macros"),
            "prompt_version": self._read_current_token(pdir / "prompts"),
        }

    def rollback_bundle(self, *, domain: str, url_pattern: str, target_version: int) -> bool:
        """Rollback current workflow/macro/prompt pointers to a target version."""
        if target_version <= 0:
            return False
        pdir = self._pattern_dir(domain, url_pattern)
        workflows = pdir / "workflows"
        macros = pdir / "macros"
        prompts = pdir / "prompts"

        dsl_target = workflows / f"v{target_version}.dsl.json"
        macro_target = macros / f"v{target_version}"
        prompt_target = prompts / f"v{target_version}"
        if not dsl_target.exists():
            return False
        if not macro_target.exists():
            return False
        if not prompt_target.exists():
            return False

        token = f"v{target_version}"
        (workflows / "current").write_text(token, encoding="utf-8")
        (macros / "current").write_text(token, encoding="utf-8")
        (prompts / "current").write_text(token, encoding="utf-8")
        return True

    def list_bundle_versions(self, *, domain: str, url_pattern: str) -> list[int]:
        """Return available workflow DSL versions for a URL pattern."""
        workflows = self._pattern_dir(domain, url_pattern) / "workflows"
        if not workflows.exists():
            return []
        versions: list[int] = []
        for path in workflows.glob("v*.dsl.json"):
            name = path.name.split(".", 1)[0]  # v1
            if not name.startswith("v"):
                continue
            try:
                versions.append(int(name[1:]))
            except ValueError:
                continue
        return sorted(set(versions))

    def get_consecutive_failures(
        self,
        *,
        domain: str,
        url_pattern: str,
        window: int = 20,
    ) -> int:
        """Count trailing consecutive failures for a URL pattern."""
        runs_path = self._domain_dir(domain) / "history" / "runs.jsonl"
        if not runs_path.exists():
            return 0

        success_status = {"executed", "ok", "recovery_completed"}
        failure_status = {"failed", "recovery_failed"}

        lines = runs_path.read_text(encoding="utf-8").splitlines()
        if window > 0:
            lines = lines[-window:]

        consecutive = 0
        for raw in reversed(lines):
            if not raw.strip():
                continue
            row = json.loads(raw)
            if str(row.get("url_pattern") or "") != url_pattern:
                continue
            status = str(row.get("status") or "").strip()
            if status in failure_status:
                consecutive += 1
                continue
            if status in success_status:
                break
        return consecutive

    def resolve_pattern_for_url(self, domain: str, url: str) -> str | None:
        """Match URL against saved pattern rules for a domain."""
        patterns_root = self._domain_dir(domain) / "url_patterns"
        if not patterns_root.exists():
            return None

        candidates: list[tuple[int, str]] = []
        parsed = urlparse(url)
        for pattern_file in patterns_root.glob("*/pattern.json"):
            payload = json.loads(pattern_file.read_text(encoding="utf-8"))
            pattern = str(payload.get("url_pattern", "")).strip()
            if not pattern:
                continue
            if self._match_url_pattern(parsed.path, parsed.query, pattern):
                score = len(pattern)
                candidates.append((score, pattern))

        if not candidates:
            return None
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]

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

    def save_health_snapshot(self, *, domain: str, payload: dict[str, Any]) -> dict[str, Any]:
        """Save latest domain-health snapshot and append history line."""
        health_dir = self._domain_dir(domain) / "health"
        health_dir.mkdir(parents=True, exist_ok=True)
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            **payload,
        }
        with (health_dir / "history.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        (health_dir / "latest.json").write_text(
            json.dumps(record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return record

    def load_latest_health_snapshot(self, *, domain: str) -> dict[str, Any] | None:
        """Load latest domain-health snapshot if present."""
        latest = self._domain_dir(domain) / "health" / "latest.json"
        if not latest.exists():
            return None
        return json.loads(latest.read_text(encoding="utf-8"))

    def get_strategy_runtime_stats(
        self,
        *,
        domain: str,
        url_pattern: str | None = None,
        window: int = 200,
    ) -> dict[str, dict[str, float | int]]:
        """Aggregate per-strategy runtime metrics from runs history."""
        runs_path = self._domain_dir(domain) / "history" / "runs.jsonl"
        if not runs_path.exists():
            return {}

        rows = runs_path.read_text(encoding="utf-8").splitlines()
        if window > 0:
            rows = rows[-window:]

        by_strategy: dict[str, dict[str, Any]] = {}
        for line in rows:
            if not line.strip():
                continue
            row = json.loads(line)
            if url_pattern and row.get("url_pattern") != url_pattern:
                continue
            strategy = str(row.get("strategy") or "").strip()
            if not strategy:
                continue
            status = str(row.get("status") or "").strip()
            if status not in {"executed", "failed", "recovery_completed", "recovery_failed"}:
                continue

            slot = by_strategy.setdefault(
                strategy,
                {
                    "runs": 0,
                    "successes": 0,
                    "costs": [],
                    "latencies": [],
                },
            )
            slot["runs"] += 1
            if status in {"executed", "recovery_completed"}:
                slot["successes"] += 1

            cost_raw = row.get("estimated_cost")
            if isinstance(cost_raw, (int, float)):
                slot["costs"].append(float(cost_raw))
            latency_raw = row.get("latency_ms")
            if isinstance(latency_raw, (int, float)):
                slot["latencies"].append(float(latency_raw))

        defaults = {
            "dom_only": (0.001, 1500.0),
            "dom_with_objdet_backup": (0.002, 2200.0),
            "objdet_dom_hybrid": (0.003, 2600.0),
            "grid_vlm": (0.006, 3400.0),
            "vlm_only": (0.008, 4200.0),
        }

        out: dict[str, dict[str, float | int]] = {}
        for strategy, slot in by_strategy.items():
            runs = int(slot["runs"])
            successes = int(slot["successes"])
            costs = list(slot["costs"])
            latencies = list(slot["latencies"])
            default_cost, default_latency = defaults.get(strategy, (0.003, 3000.0))
            avg_cost = sum(costs) / len(costs) if costs else default_cost
            p95_latency_ms = (
                self._percentile(latencies, 0.95) if latencies else default_latency
            )
            out[strategy] = {
                "runs": runs,
                "success_rate": (successes / runs) if runs else 0.0,
                "avg_cost": float(avg_cost),
                "p95_latency_ms": int(round(p95_latency_ms)),
            }
        return out

    def get_maturity_state(self, *, domain: str, recent_window: int = 20) -> MaturityState:
        """Compute domain maturity state from run history."""
        runs_path = self._domain_dir(domain) / "history" / "runs.jsonl"
        if not runs_path.exists():
            return MaturityState(
                domain=domain,
                total_runs=0,
                recent_success_rate=0.0,
                consecutive_successes=0,
                llm_calls_last_10=0,
            )

        success_status = {"executed", "ok", "recovery_completed"}
        fail_status = {"failed", "recovery_failed"}

        outcomes: list[bool] = []
        llm_counts: list[int] = []
        for raw in runs_path.read_text(encoding="utf-8").splitlines():
            if not raw.strip():
                continue
            row = json.loads(raw)
            status = str(row.get("status") or "").strip()
            if status in success_status:
                outcomes.append(True)
            elif status in fail_status:
                outcomes.append(False)
            else:
                continue
            llm_raw = row.get("llm_calls", 0)
            llm_counts.append(int(llm_raw) if isinstance(llm_raw, int) else 0)

        total_runs = len(outcomes)
        if total_runs == 0:
            return MaturityState(
                domain=domain,
                total_runs=0,
                recent_success_rate=0.0,
                consecutive_successes=0,
                llm_calls_last_10=0,
            )

        recent = outcomes[-recent_window:] if recent_window > 0 else outcomes
        recent_success_rate = sum(1 for ok in recent if ok) / len(recent)

        consecutive = 0
        for ok in reversed(outcomes):
            if not ok:
                break
            consecutive += 1

        llm_calls_last_10 = sum(llm_counts[-10:])
        return MaturityState(
            domain=domain,
            total_runs=total_runs,
            recent_success_rate=recent_success_rate,
            consecutive_successes=consecutive,
            llm_calls_last_10=llm_calls_last_10,
        )

    @staticmethod
    def _next_pattern_version(root: Path, suffix: str) -> int:
        highest = 0
        for path in root.glob(f"v*{suffix}"):
            name = path.name.split(".", 1)[0]
            if not name.startswith("v"):
                continue
            try:
                highest = max(highest, int(name[1:]))
            except ValueError:
                continue
        return highest + 1

    @staticmethod
    def _read_current_version(root: Path) -> int | None:
        cur = root / "current"
        if cur.exists():
            raw = cur.read_text(encoding="utf-8").strip()
            if raw.startswith("v"):
                try:
                    return int(raw[1:])
                except ValueError:
                    return None
        versions: list[int] = []
        for path in root.glob("v*.dsl.json"):
            name = path.stem  # v1.dsl
            head = name.split(".", 1)[0]
            if head.startswith("v"):
                try:
                    versions.append(int(head[1:]))
                except ValueError:
                    continue
        return max(versions) if versions else None

    @staticmethod
    def _read_current_token(root: Path) -> int | None:
        cur = root / "current"
        if not cur.exists():
            return None
        raw = cur.read_text(encoding="utf-8").strip()
        if not raw.startswith("v"):
            return None
        try:
            return int(raw[1:])
        except ValueError:
            return None

    @staticmethod
    def _match_url_pattern(path: str, query: str, pattern: str) -> bool:
        if "?" in pattern:
            base, expected_query = pattern.split("?", 1)
            if path != base:
                return False
            if not expected_query:
                return True
            required_keys = {pair.split("=", 1)[0] for pair in expected_query.split("&") if pair}
            actual_keys = {pair.split("=", 1)[0] for pair in query.split("&") if pair}
            # "query=*" is treated as generic "search query exists" placeholder.
            if required_keys == {"query"}:
                return bool(actual_keys)
            return required_keys.issubset(actual_keys)
        if pattern.endswith("*"):
            return path.startswith(pattern[:-1])
        return path == pattern

    @staticmethod
    def _percentile(values: list[float], q: float) -> float:
        if not values:
            return 0.0
        sorted_vals = sorted(values)
        q = min(max(q, 0.0), 1.0)
        idx = max(0, min(len(sorted_vals) - 1, math.ceil(len(sorted_vals) * q) - 1))
        return float(sorted_vals[idx])
