from src.recon.failure_analyzer import FailureAnalyzer


def test_classify_timeout_as_timing() -> None:
    analyzer = FailureAnalyzer()
    out = analyzer.classify(error="TimeoutError: waiting for selector timed out")
    assert out.category == "timing"
    assert out.recommended_action == "add_wait"


def test_classify_selector_missing_by_verify_code() -> None:
    analyzer = FailureAnalyzer()
    out = analyzer.classify(
        error="verify failed",
        verify_code="EXPECT_SELECTOR_MISSING",
    )
    assert out.category == "selector"
    assert out.recommended_action == "fix_selector"


def test_classify_interaction_hidden_element() -> None:
    analyzer = FailureAnalyzer()
    out = analyzer.classify(error="element is not visible and intercepted")
    assert out.category == "interaction"


def test_classify_runtime_js_error() -> None:
    analyzer = FailureAnalyzer()
    out = analyzer.classify(error="TypeError: Cannot read properties of undefined")
    assert out.category == "runtime"


def test_classify_security_challenge() -> None:
    analyzer = FailureAnalyzer()
    out = analyzer.classify(error="captcha required before continue")
    assert out.category == "security"
    assert out.recommended_action == "human_handoff"
