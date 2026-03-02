"""Recon scanners for DOM, visual, and navigation signals."""

from __future__ import annotations

import hashlib
import json
from typing import Any, Protocol
from urllib.parse import parse_qs, urlparse

from playwright.async_api import Browser, Page, async_playwright


class IPageScanner(Protocol):
    async def scan_page(self, page: Page) -> dict[str, Any]: ...


def _sha1(data: object) -> str:
    return hashlib.sha1(repr(data).encode("utf-8")).hexdigest()  # noqa: S324


def _url_pattern_from_url(url: str) -> str:
    parsed = urlparse(url)
    path = parsed.path or "/"
    if not parsed.query:
        return path

    query = parse_qs(parsed.query, keep_blank_values=True)
    keys = sorted(query.keys())
    if not keys:
        return path
    if len(keys) == 1 and keys[0].lower() in {"q", "query", "keyword", "search"}:
        return f"{path}?query=*"
    encoded = "&".join(f"{k}=*" for k in keys)
    return f"{path}?{encoded}"


class _PlaywrightURLFallback:
    """Fallback helper: scan a URL when only URL is available."""

    async def _scan_url(self, url: str, scanner: IPageScanner) -> dict[str, Any]:
        async with async_playwright() as p:
            browser: Browser = await p.chromium.launch(headless=True)
            try:
                page = await browser.new_page()
                await page.goto(url, wait_until="domcontentloaded", timeout=45_000)
                return await scanner.scan_page(page)
            finally:
                await browser.close()


class DOMScanner(_PlaywrightURLFallback):
    """Extract framework/SPA/hash-level DOM signals."""

    async def scan(self, url: str) -> dict[str, Any]:
        return await self._scan_url(url, self)

    async def scan_page(self, page: Page) -> dict[str, Any]:
        dom_eval = await page.evaluate(
            """() => {
                const framework = (() => {
                    if (window.__NEXT_DATA__) return "nextjs";
                    if (window.__NUXT__) return "nuxt";
                    const reactRoot = document.querySelector(
                        '[data-reactroot],[data-reactid]'
                    );
                    if (window.React || reactRoot) return "react";
                    if (window.Vue || document.querySelector('[data-v-app]')) return "vue";
                    const ngRoot = document.querySelector('[ng-app],[ng-controller]');
                    if (window.angular || ngRoot) return "angular";
                    return null;
                })();

                const total = document.querySelectorAll('*').length;
                const interactiveSelectors = [
                    'a',
                    'button',
                    'input',
                    'select',
                    'textarea',
                    '[role="button"]',
                ].join(',');
                const interactive = document.querySelectorAll(interactiveSelectors).length;
                return {
                    framework,
                    is_spa: !!(window.history && window.history.pushState),
                    total_elements: total,
                    interactive_count: interactive,
                };
            }"""
        )

        cdp = await page.context.new_cdp_session(page)
        dom_doc: dict[str, Any] = {}
        ax_tree: dict[str, Any] = {}
        try:
            dom_doc = await cdp.send("DOM.getDocument", {"depth": 2, "pierce": True})
        except Exception:
            dom_doc = {}
        try:
            ax_tree = await cdp.send("Accessibility.getFullAXTree")
        except Exception:
            ax_tree = {}

        dom_hash = _sha1(
            {
                "url": page.url,
                "dom": dom_doc.get("root", {}),
                "counts": dom_eval,
            }
        )
        ax_hash = _sha1(ax_tree.get("nodes", []))

        return {
            "framework": dom_eval.get("framework"),
            "is_spa": bool(dom_eval.get("is_spa", False)),
            "total_elements": int(dom_eval.get("total_elements", 0)),
            "interactive_count": int(dom_eval.get("interactive_count", 0)),
            "url_pattern": _url_pattern_from_url(page.url),
            "dom_hash": dom_hash,
            "ax_hash": ax_hash,
        }


class VisualScanner(_PlaywrightURLFallback):
    """Extract repeating structures and obstacle hints."""

    async def scan(self, url: str) -> dict[str, Any]:
        return await self._scan_url(url, self)

    async def scan_page(self, page: Page) -> dict[str, Any]:
        raw = await page.evaluate(
            """() => {
                const repeating = new Set();
                const parentSelectors = ['main', 'section', 'article', 'div', 'ul', 'ol'].join(',');
                const parents = Array.from(document.querySelectorAll(parentSelectors));

                for (const parent of parents) {
                    const kids = Array.from(parent.children);
                    if (kids.length < 3) continue;
                    const byTag = {};
                    for (const k of kids) {
                        byTag[k.tagName] = (byTag[k.tagName] || 0) + 1;
                    }
                    const top = Object.entries(byTag).sort((a,b) => b[1]-a[1])[0];
                    if (top && top[1] >= 3) {
                        repeating.add(`${parent.tagName}>${top[0]}*${top[1]}`);
                    }
                }

                const productSelectors = [
                    '[class*="product"]',
                    '[class*="item"]',
                    '[data-testid*="product"]',
                ].join(', ');
                const articleSelectors = [
                    'article',
                    '[class*="news"]',
                    '[class*="post"]',
                ].join(', ');
                const productSignals = document.querySelectorAll(productSelectors).length;
                const articleSignals = document.querySelectorAll(articleSelectors).length;

                const contentTypes = [];
                if (productSignals >= 3) contentTypes.push('product_list');
                if (articleSignals >= 3) contentTypes.push('article_list');
                if (contentTypes.length === 0) contentTypes.push('generic_page');

                const obstacleTypes = [];
                const overlays = Array.from(document.querySelectorAll('*')).filter((el) => {
                    const style = window.getComputedStyle(el);
                    if (style.position !== 'fixed') return false;
                    const z = parseInt(style.zIndex || '0', 10);
                    return z >= 1000 && el.clientWidth > 150 && el.clientHeight > 80;
                });
                if (overlays.length > 0) obstacleTypes.push('overlay');
                if (document.body.innerText.toLowerCase().includes('cookie')) {
                    obstacleTypes.push('cookie_banner');
                }

                return {
                    repeating_patterns: Array.from(repeating).slice(0, 12),
                    content_types: contentTypes,
                    obstacle_types: obstacleTypes,
                    image_count: document.images.length,
                };
            }"""
        )
        return {
            "repeating_patterns": list(raw.get("repeating_patterns", [])),
            "content_types": list(raw.get("content_types", [])),
            "obstacle_types": list(raw.get("obstacle_types", [])),
            "visual_hash": _sha1(raw),
        }


class NavigationScanner(_PlaywrightURLFallback):
    """Extract navigation/interaction/api hints."""

    async def scan(self, url: str) -> dict[str, Any]:
        return await self._scan_url(url, self)

    async def scan_page(self, page: Page) -> dict[str, Any]:
        dom_hints = await page.evaluate(
            """() => {
                const navigationHints = [];
                const interactionHints = [];

                const navSelectors = ['nav', '[role="navigation"]'].join(', ');
                const searchSelectors = [
                    'input[type="search"]',
                    'input[name*="search" i]',
                    '[aria-label*="검색"]',
                    '[aria-label*="search" i]',
                ].join(', ');
                const breadcrumbSelectors = [
                    '[aria-current="page"]',
                    '.breadcrumb',
                    '[class*="breadcrumb"]',
                ].join(', ');

                if (document.querySelector(navSelectors)) navigationHints.push('category');
                if (document.querySelector(searchSelectors)) navigationHints.push('search');
                if (document.querySelector(breadcrumbSelectors)) navigationHints.push('breadcrumb');

                const hoverSelectors = [
                    '[aria-haspopup="menu"]',
                    '[class*="menu"]',
                    '[role="menu"]',
                ].join(', ');
                if (document.querySelector(hoverSelectors)) {
                    interactionHints.push('hover_menu');
                }
                const dragSelectors = [
                    '[class*="slider"]',
                    '[aria-valuemin]',
                    '[aria-valuemax]',
                ].join(', ');
                if (document.querySelector(dragSelectors)) {
                    interactionHints.push('drag_control');
                }

                return {navigation_hints: navigationHints, interaction_hints: interactionHints};
            }"""
        )

        api_entries = await page.evaluate(
            """() => {
                try {
                    const entries = performance.getEntriesByType('resource') || [];
                    const urls = entries
                        .filter((e) => {
                            return e.initiatorType === 'fetch'
                                || e.initiatorType === 'xmlhttprequest';
                        })
                        .map((e) => {
                            try {
                                const u = new URL(e.name, location.href);
                                if (u.origin !== location.origin) return null;
                                return u.pathname;
                            } catch {
                                return null;
                            }
                        })
                        .filter(Boolean);
                    return Array.from(new Set(urls)).slice(0, 30);
                } catch {
                    return [];
                }
            }"""
        )

        endpoints: list[str]
        if isinstance(api_entries, dict):
            raw = api_entries.get("api_endpoints", [])
            endpoints = [str(v) for v in raw] if isinstance(raw, list) else []
        elif isinstance(api_entries, list):
            endpoints = [str(v) for v in api_entries]
        else:
            endpoints = []

        return {
            "navigation_hints": list(dom_hints.get("navigation_hints", [])),
            "interaction_hints": list(dom_hints.get("interaction_hints", [])),
            "api_endpoints": endpoints,
            "navigation_hash": _sha1({"hints": dom_hints, "apis": endpoints}),
        }


def pattern_dir_from_url_pattern(url_pattern: str) -> str:
    """Convert URL pattern to stable directory name."""
    parsed = urlparse(url_pattern)
    path = parsed.path or url_pattern
    clean = path.strip("/").split("/")[0]
    return clean or "root"


def serialize_prompt_map(prompts: dict[str, str]) -> dict[str, str]:
    """Normalize prompt map for writing to prompt YAML-like files."""
    return {k: v for k, v in prompts.items() if k.strip()}


def pretty_json(data: object) -> str:
    return json.dumps(data, ensure_ascii=False, indent=2)
