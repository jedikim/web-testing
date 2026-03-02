"""Recon/CodeGen foundation modules.

Phase-1 bootstrap for the v4.3 architecture:
- Site profile model
- Provider/model registry
- Knowledge base persistence
- Recon agent orchestration
"""

from src.recon.agent import ReconAgent
from src.recon.codegen import CodeGenAgent, StrategyDecision
from src.recon.knowledge_base import KnowledgeBase
from src.recon.langgraph_recon import ReconWorkflow, build_recon_workflow
from src.recon.litellm_router import ModelRegistry, ModelRole, build_model_registry
from src.recon.models import GeneratedBundle, MaturityState, SiteProfile
from src.recon.runtime import ReconRuntime, RuntimeLookup
from src.recon.scanners import DOMScanner, NavigationScanner, VisualScanner
from src.recon.validator import CodeValidator, ValidationResult

__all__ = [
    "ReconAgent",
    "CodeGenAgent",
    "StrategyDecision",
    "KnowledgeBase",
    "ReconWorkflow",
    "build_recon_workflow",
    "ModelRole",
    "ModelRegistry",
    "build_model_registry",
    "GeneratedBundle",
    "MaturityState",
    "SiteProfile",
    "DOMScanner",
    "VisualScanner",
    "NavigationScanner",
    "ReconRuntime",
    "RuntimeLookup",
    "CodeValidator",
    "ValidationResult",
]
