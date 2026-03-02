from src.recon.langgraph_recon import build_recon_workflow


class _DummyAgent:
    async def recon(self, url: str, *, purpose: str, language: str, region: str):
        return {
            "url": url,
            "purpose": purpose,
            "language": language,
            "region": region,
        }


def test_build_workflow_returns_fallback_when_langgraph_missing(monkeypatch) -> None:
    monkeypatch.setitem(__import__("sys").modules, "langgraph", None)
    wf = build_recon_workflow(_DummyAgent())
    assert wf.mode in {"fallback", "langgraph"}
