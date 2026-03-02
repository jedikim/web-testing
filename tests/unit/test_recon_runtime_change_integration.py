import json

from src.recon.change_detector import ChangeDetector
from src.recon.knowledge_base import KnowledgeBase
from src.recon.runtime import ReconRuntime


def test_runtime_change_check_logs_report(tmp_path) -> None:
    kb = KnowledgeBase(base_dir=tmp_path)
    runtime = ReconRuntime(kb)
    detector = ChangeDetector()

    out = runtime.detect_change_stub(
        domain="example.com",
        url_pattern="/search?query=*",
        detector=detector,
        selector_survival_rate=0.82,
        ax_diff_ratio=0.24,
        api_schema_diff_ratio=0.22,
        dead_selectors=[".old-card"],
    )

    assert out["changed"] is True
    assert out["reason"] == "content_update"

    runs = (tmp_path / "example.com" / "history" / "runs.jsonl").read_text(encoding="utf-8")
    row = json.loads(runs.strip().splitlines()[-1])
    assert row["status"] == "change_check"
    assert row["change_changed"] is True
    assert row["change_reason"] == "content_update"
