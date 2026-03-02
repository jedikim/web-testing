from src.recon.knowledge_base import KnowledgeBase


def test_kb_save_and_load_latest_health_snapshot(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)

    kb.save_health_snapshot(
        domain="example.com",
        payload={"stage": "warm", "needs_auto_rollback": False},
    )
    kb.save_health_snapshot(
        domain="example.com",
        payload={"stage": "hot", "needs_auto_rollback": False},
    )

    latest = kb.load_latest_health_snapshot(domain="example.com")

    assert latest is not None
    assert latest["stage"] == "hot"


def test_kb_load_latest_health_snapshot_none_when_missing(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    latest = kb.load_latest_health_snapshot(domain="example.com")
    assert latest is None
