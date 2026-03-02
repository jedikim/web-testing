from __future__ import annotations

import pytest

from src.recon.playwright_runner import PlaywrightStepRunner


def _playwright_importable() -> bool:
    try:
        import playwright.sync_api  # noqa: F401

        return True
    except Exception:
        return False


@pytest.mark.skipif(not _playwright_importable(), reason="playwright not installed")
def test_playwright_runner_basic_local_page(tmp_path) -> None:
    html_path = tmp_path / "page.html"
    html_path.write_text(
        """
        <html>
          <body>
            <ul id='list'>
              <li class='item'>A</li>
              <li class='item'>B</li>
              <li class='item'>C</li>
            </ul>
          </body>
        </html>
        """,
        encoding="utf-8",
    )

    runner = PlaywrightStepRunner(headless=True)
    context: dict[str, object] = {}

    steps = [
        {"id": "open", "action": "goto", "target": html_path.as_uri()},
        {"id": "capture", "action": "capture_dom"},
        {
            "id": "extract",
            "action": "extract_candidates",
            "params": {"selector": "li.item"},
        },
        {"id": "verify", "action": "verify_result", "verify": {"min_items": 2}},
    ]

    try:
        first = runner.run_step(step=steps[0], context=context)
        if not first.ok and first.error:
            msg = first.error.lower()
            if "playwright init failed" in msg or "executable doesn't exist" in msg:
                pytest.skip(first.error)
        assert first.ok is True

        for step in steps[1:]:
            out = runner.run_step(step=step, context=context)
            assert out.ok is True, out.error

        assert int(context.get("candidate_count", 0)) == 3
        assert bool(context.get("dom_captured")) is True
    finally:
        runner.close(context=context)
