from src.recon.scanners import DOMScanner, NavigationScanner, VisualScanner


class _FakePage:
    def __init__(self, *, url: str, eval_result: dict, cdp_result: dict | None = None) -> None:
        self.url = url
        self._eval_result = eval_result
        self._cdp_result = cdp_result or {}

    async def evaluate(self, script: str):
        _ = script
        return self._eval_result

    class _Ctx:
        def __init__(self, cdp_result: dict) -> None:
            self._cdp_result = cdp_result

        async def new_cdp_session(self, page: object):
            _ = page

            class _Session:
                def __init__(self, result: dict) -> None:
                    self._result = result

                async def send(self, method: str, params: dict | None = None):
                    _ = params
                    if method == "Accessibility.getFullAXTree":
                        return {"nodes": self._result.get("ax_nodes", [])}
                    if method == "DOM.getDocument":
                        return {"root": self._result.get("dom_root", {"nodeName": "HTML"})}
                    return {}

            return _Session(self._cdp_result)

    @property
    def context(self):
        return self._Ctx(self._cdp_result)


async def test_dom_scanner_reads_framework_and_hashes() -> None:
    page = _FakePage(
        url="https://example.com/search?q=tv",
        eval_result={
            "framework": "react",
            "is_spa": True,
            "interactive_count": 12,
            "total_elements": 250,
            "url_pattern": "/search?query=*",
        },
        cdp_result={"ax_nodes": [{"role": "button"}]},
    )

    result = await DOMScanner().scan_page(page)
    assert result["framework"] == "react"
    assert result["is_spa"] is True
    assert result["url_pattern"] == "/search?query=*"
    assert "dom_hash" in result
    assert "ax_hash" in result


async def test_visual_scanner_extracts_repeating_patterns() -> None:
    page = _FakePage(
        url="https://example.com/list",
        eval_result={
            "repeating_patterns": ["product_card", "product_card"],
            "content_types": ["product_list"],
            "obstacle_types": ["popup"],
        },
    )

    result = await VisualScanner().scan_page(page)
    assert "product_card" in result["repeating_patterns"]
    assert result["content_types"] == ["product_list"]


async def test_navigation_scanner_extracts_hints() -> None:
    page = _FakePage(
        url="https://example.com",
        eval_result={
            "navigation_hints": ["category", "search"],
            "interaction_hints": ["hover_menu"],
            "api_endpoints": ["/api/search"],
        },
    )

    result = await NavigationScanner().scan_page(page)
    assert "category" in result["navigation_hints"]
    assert result["api_endpoints"] == ["/api/search"]
