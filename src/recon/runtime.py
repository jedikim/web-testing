"""Runtime helper for URL-pattern bundle lookup and run logging."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urlparse

from src.recon.codegen import CodeGenAgent
from src.recon.knowledge_base import KnowledgeBase
from src.recon.models import SiteProfile
from src.recon.validator import CodeValidator


@dataclass(frozen=True)
class RuntimeLookup:
    domain: str
    url: str
    url_pattern: str | None
    bundle: Any | None
    workflow_version: int | None
    prompt_version: int | None


class ICodeGenAgent(Protocol):
    def generate_bundle(self, *, profile: SiteProfile, url: str, intent: str) -> Any: ...


class ReconRuntime:
    """Minimal runtime bridge: lookup bundle and append versioned run logs."""

    def __init__(self, kb: KnowledgeBase) -> None:
        self.kb = kb

    def resolve(self, *, domain: str, url: str) -> RuntimeLookup:
        pattern = self.kb.resolve_pattern_for_url(domain, url)
        if pattern is None:
            return RuntimeLookup(
                domain=domain,
                url=url,
                url_pattern=None,
                bundle=None,
                workflow_version=None,
                prompt_version=None,
            )
        bundle = self.kb.load_current_bundle(domain, pattern)
        versions = self.kb.get_current_versions(domain, pattern)
        return RuntimeLookup(
            domain=domain,
            url=url,
            url_pattern=pattern,
            bundle=bundle,
            workflow_version=versions.get("workflow_version"),
            prompt_version=versions.get("prompt_version"),
        )

    def execute_stub(self, *, domain: str, url: str, intent: str) -> dict[str, Any]:
        """Simulate one runtime execution and log versioned run metadata.

        This is a stub for integration wiring until full executor binding
        is connected to DSL/macros.
        """
        lookup = self.resolve(domain=domain, url=url)
        parsed = urlparse(url)
        fallback_pattern = parsed.path or "/"

        if lookup.bundle is None or lookup.url_pattern is None:
            self.kb.append_run(
                domain=domain,
                url_pattern=fallback_pattern,
                payload={
                    "status": "miss",
                    "intent": intent,
                    "bundle_version": None,
                    "prompt_version": None,
                    "reason": "bundle_not_found",
                },
            )
            return {
                "status": "miss",
                "bundle_version": None,
                "prompt_version": None,
            }

        self.kb.append_run(
            domain=domain,
            url_pattern=lookup.url_pattern,
            payload={
                "status": "ok",
                "intent": intent,
                "bundle_version": lookup.workflow_version,
                "prompt_version": lookup.prompt_version,
            },
        )
        return {
            "status": "ok",
            "bundle_version": lookup.workflow_version,
            "prompt_version": lookup.prompt_version,
        }

    def execute_or_generate_stub(
        self,
        *,
        domain: str,
        url: str,
        intent: str,
        profile: SiteProfile,
        codegen_agent: ICodeGenAgent | CodeGenAgent,
        validator: CodeValidator | None = None,
    ) -> dict[str, Any]:
        """Execute if bundle exists; otherwise generate + save + log."""
        lookup = self.resolve(domain=domain, url=url)
        if lookup.bundle is not None and lookup.url_pattern is not None:
            return self.execute_stub(domain=domain, url=url, intent=intent)

        generated = codegen_agent.generate_bundle(profile=profile, url=url, intent=intent)
        if validator is not None:
            v = validator.validate_bundle(bundle=generated, profile=profile, intent=intent)
            if not v.overall:
                self.kb.append_run(
                    domain=domain,
                    url_pattern=str(profile.url_pattern or "/"),
                    payload={
                        "status": "generation_failed",
                        "intent": intent,
                        "bundle_version": None,
                        "prompt_version": None,
                        "errors": v.errors,
                    },
                )
                return {
                    "status": "generation_failed",
                    "bundle_version": None,
                    "prompt_version": None,
                    "errors": v.errors,
                }

        version = self.kb.save_bundle(domain, generated.workflow_dsl["url_pattern"], generated)

        self.kb.append_run(
            domain=domain,
            url_pattern=str(generated.workflow_dsl["url_pattern"]),
            payload={
                "status": "generated",
                "intent": intent,
                "bundle_version": version,
                "prompt_version": version,
            },
        )
        return {
            "status": "generated",
            "bundle_version": version,
            "prompt_version": version,
        }
