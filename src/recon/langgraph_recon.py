"""LangGraph-compatible recon workflow wrapper."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

Runner = Callable[[str, str, str, str], Awaitable[Any]]


@dataclass
class ReconWorkflow:
    """Compiled recon workflow wrapper."""

    mode: str  # "langgraph" | "fallback"
    _runner: Runner

    async def run(
        self,
        *,
        url: str,
        purpose: str = "unknown",
        language: str = "unknown",
        region: str = "unknown",
    ) -> Any:
        return await self._runner(url, purpose, language, region)


def build_recon_workflow(agent: Any) -> ReconWorkflow:
    """Build LangGraph workflow if available, otherwise fallback."""
    try:
        from langgraph.graph import END, START, StateGraph
    except Exception:
        return ReconWorkflow(mode="fallback", _runner=_fallback_runner(agent))

    class _State(dict):
        url: str
        purpose: str
        language: str
        region: str
        profile: Any

    async def _recon_node(state: _State) -> _State:
        profile = await agent.recon(
            state["url"],
            purpose=state["purpose"],
            language=state["language"],
            region=state["region"],
        )
        return {
            **state,
            "profile": profile,
        }

    graph = StateGraph(_State)
    graph.add_node("recon", _recon_node)
    graph.add_edge(START, "recon")
    graph.add_edge("recon", END)
    compiled = graph.compile()

    async def _runner(url: str, purpose: str, language: str, region: str) -> Any:
        result = await compiled.ainvoke(
            {
                "url": url,
                "purpose": purpose,
                "language": language,
                "region": region,
                "profile": None,
            }
        )
        return result.get("profile")

    return ReconWorkflow(mode="langgraph", _runner=_runner)


def _fallback_runner(agent: Any) -> Runner:
    async def _runner(url: str, purpose: str, language: str, region: str) -> Any:
        return await agent.recon(
            url,
            purpose=purpose,
            language=language,
            region=region,
        )

    return _runner
