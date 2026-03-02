from src.recon.knowledge_base import KnowledgeBase


def test_kb_maturity_is_cold_without_runs(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    state = kb.get_maturity_state(domain="example.com")

    assert state.domain == "example.com"
    assert state.total_runs == 0
    assert state.recent_success_rate == 0.0
    assert state.consecutive_successes == 0
    assert state.llm_calls_last_10 == 0
    assert state.evaluate_stage() == "cold"


def test_kb_maturity_reaches_warm_when_success_rate_is_good(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    # 5 success, 2 fail => 0.714 success rate
    for _ in range(5):
        kb.append_run(
            domain="example.com",
            url_pattern="/search?query=*",
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 0},
        )
    for _ in range(2):
        kb.append_run(
            domain="example.com",
            url_pattern="/search?query=*",
            payload={"status": "failed", "strategy": "dom_only", "llm_calls": 0},
        )

    state = kb.get_maturity_state(domain="example.com")

    assert state.total_runs == 7
    assert 0.70 <= state.recent_success_rate < 0.95
    assert state.evaluate_stage() == "warm"


def test_kb_maturity_reaches_hot_on_10_successes_without_llm(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    for _ in range(12):
        kb.append_run(
            domain="example.com",
            url_pattern="/search?query=*",
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 0},
        )

    state = kb.get_maturity_state(domain="example.com")

    assert state.total_runs == 12
    assert state.recent_success_rate >= 0.95
    assert state.consecutive_successes >= 10
    assert state.llm_calls_last_10 == 0
    assert state.evaluate_stage() == "hot"


def test_kb_maturity_not_hot_when_recent_llm_calls_exist(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    for _ in range(12):
        kb.append_run(
            domain="example.com",
            url_pattern="/search?query=*",
            payload={"status": "executed", "strategy": "dom_only", "llm_calls": 1},
        )

    state = kb.get_maturity_state(domain="example.com")

    assert state.llm_calls_last_10 > 0
    assert state.evaluate_stage() == "warm"
