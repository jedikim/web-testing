"""web-agentic package root.

Importing ``src`` should be cheap and should not eagerly import optional
runtime integrations. This file exposes top-level names via lazy imports.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "WebAgent",
    "LLMFirstOrchestrator",
    "RunResult",
    "Executor",
    "create_executor",
    "ExecutorPool",
    "SelectorCache",
    "StepDefinition",
    "StepResult",
    "PageState",
]


def __getattr__(name: str) -> Any:
    if name == "WebAgent":
        from src.web_agent import WebAgent

        return WebAgent
    if name in {"LLMFirstOrchestrator", "RunResult"}:
        from src.core.llm_orchestrator import LLMFirstOrchestrator, RunResult

        return {"LLMFirstOrchestrator": LLMFirstOrchestrator, "RunResult": RunResult}[name]
    if name in {"Executor", "create_executor"}:
        from src.core.executor import Executor, create_executor

        return {"Executor": Executor, "create_executor": create_executor}[name]
    if name == "ExecutorPool":
        from src.core.executor_pool import ExecutorPool

        return ExecutorPool
    if name == "SelectorCache":
        from src.core.selector_cache import SelectorCache

        return SelectorCache
    if name in {"StepDefinition", "StepResult", "PageState"}:
        from src.core.types import PageState, StepDefinition, StepResult

        return {
            "StepDefinition": StepDefinition,
            "StepResult": StepResult,
            "PageState": PageState,
        }[name]
    raise AttributeError(f"module 'src' has no attribute {name!r}")
