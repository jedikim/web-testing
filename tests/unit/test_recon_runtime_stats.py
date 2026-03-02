from src.recon.knowledge_base import KnowledgeBase


def test_kb_aggregates_strategy_runtime_stats(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    kb.append_run(
        domain="example.com",
        url_pattern="/search?query=*",
        payload={
            "status": "executed",
            "strategy": "dom_only",
            "latency_ms": 1100,
            "estimated_cost": 0.001,
        },
    )
    kb.append_run(
        domain="example.com",
        url_pattern="/search?query=*",
        payload={
            "status": "failed",
            "strategy": "dom_only",
            "latency_ms": 2200,
            "estimated_cost": 0.0012,
        },
    )
    kb.append_run(
        domain="example.com",
        url_pattern="/search?query=*",
        payload={
            "status": "executed",
            "strategy": "grid_vlm",
            "latency_ms": 5200,
            "estimated_cost": 0.008,
        },
    )

    stats = kb.get_strategy_runtime_stats(domain="example.com")

    assert set(stats) >= {"dom_only", "grid_vlm"}
    assert stats["dom_only"]["runs"] == 2
    assert 0.49 < stats["dom_only"]["success_rate"] < 0.51
    assert stats["dom_only"]["avg_cost"] > 0
    assert stats["dom_only"]["p95_latency_ms"] >= 1100

    assert stats["grid_vlm"]["runs"] == 1
    assert stats["grid_vlm"]["success_rate"] == 1.0
