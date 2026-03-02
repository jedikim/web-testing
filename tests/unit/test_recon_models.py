from src.recon.models import MaturityState


def test_maturity_cold_default() -> None:
    state = MaturityState(
        domain="example.com",
        total_runs=0,
        recent_success_rate=0.0,
        consecutive_successes=0,
        llm_calls_last_10=0,
    )
    assert state.evaluate_stage() == "cold"


def test_maturity_warm_transition() -> None:
    state = MaturityState(
        domain="example.com",
        total_runs=4,
        recent_success_rate=0.8,
        consecutive_successes=2,
        llm_calls_last_10=4,
    )
    assert state.evaluate_stage() == "warm"


def test_maturity_hot_transition() -> None:
    state = MaturityState(
        domain="example.com",
        total_runs=20,
        recent_success_rate=0.98,
        consecutive_successes=12,
        llm_calls_last_10=0,
    )
    assert state.evaluate_stage() == "hot"
