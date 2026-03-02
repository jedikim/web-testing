from src.recon.litellm_router import ModelRole, build_model_registry


def test_registry_prefers_gemini_when_key_present(monkeypatch) -> None:
    monkeypatch.setenv("GEMINI_API_KEY", "x")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    registry = build_model_registry()

    assert registry.provider == "gemini"
    assert registry.model_for(ModelRole.FAST) == "gemini-3-flash-preview"
    assert registry.model_for(ModelRole.STRONG) == "gemini-3.1-pro-preview"


def test_registry_uses_openai_when_only_openai_key(monkeypatch) -> None:
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "x")

    registry = build_model_registry()

    assert registry.provider == "openai"
    assert registry.model_for(ModelRole.FAST) == "gpt-5-mini"
    assert registry.model_for(ModelRole.CODEGEN) == "gpt-5.3-codex"
