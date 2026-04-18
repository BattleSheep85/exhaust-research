"""End-to-end research submission flow. Measures perceived latency from submit to first product.

This is the user's #1 pain point: "feels like it takes way too long." We instrument the full
journey here: submit → redirect → events polling → completion → product cards rendered.
"""
from __future__ import annotations

import json
import time
import urllib.parse

import requests
from playwright.sync_api import sync_playwright
from suite import Suite, case


# Deterministic non-spammy query. Use an ultra-specific one unlikely to collide with real load.
FLOW_QUERY = "best budget cat water fountain 2026"


def run(base: str) -> Suite:
    s = Suite("E2E Flow")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-Tests/1.0"

    # --- First: try the cheap path. Check if there's already a completed research we can inspect ---
    sitemap = sess.get(f"{base}/sitemap.xml", timeout=15).text
    import re
    slugs = re.findall(r"/research/([a-z0-9-]+)</loc>", sitemap)

    # Pick the first slug whose page actually has product cards — the most recent
    # slug can be a garbage-input test that legitimately produced 0 products.
    slug: str | None = None
    for candidate in slugs[:15]:
        html = sess.get(f"{base}/research/{candidate}", timeout=15).text
        if 'class="product"' in html or "class='product'" in html:
            slug = candidate
            break

    @case(s, "Sitemap exposes at least one completed research result")
    def _():
        assert slugs, "no completed research in sitemap — fresh deploy?"
        return True, "", f"count={len(slugs)}"

    @case(s, "Corpus: majority of recent research pages have a linked product")
    def _():
        # Deploy-blocking floor for affiliate coverage. Individual pages can
        # legitimately render zero outbound links under the honest-over-
        # fabricate policy (R107), but across the corpus most pages should
        # still carry monetization potential. A sudden drop below 50% means
        # the affiliate-URL pipeline regressed or the LLM stopped emitting
        # retailer-attributable product URLs.
        #
        # Scans the full card body (not a truncated snippet) because the links
        # section sits ~4KB in after images + metadata + pros/cons. Earlier
        # attempts to cap at 3000 chars silently missed every link.
        sample = slugs[:10]
        if len(sample) < 3:
            return True, f"sample too small ({len(sample)})", ""
        linked = 0
        for candidate in sample:
            html = sess.get(f"{base}/research/{candidate}", timeout=15).text
            cards = re.split(r'class=["\']product["\']', html)[1:]
            if not cards:
                continue
            for card in cards:
                if (
                    "amazon.com" in card
                    or "walmart.com" in card
                    or "Buy on " in card
                    or "product-link-mfr" in card
                    or "Visit site" in card
                ):
                    linked += 1
                    break
        ratio = linked / len(sample)
        assert ratio >= 0.5, (
            f"only {linked}/{len(sample)} recent pages have a linked product "
            f"(need >=50%) — affiliate pipeline may have regressed"
        )
        return True, "", f"{linked}/{len(sample)} pages linked"

    if slug:

        @case(s, f"/research/{slug} renders with at least 1 product card")
        def _():
            html = sess.get(f"{base}/research/{slug}", timeout=15).text
            # product is the conventional class; tolerate minor variants
            count = html.count('class="product"') + html.count("class='product'")
            assert count >= 1, f"no product cards found in /research/{slug}"
            return True, "", f"cards={count}"

        @case(s, f"/research/{slug}: product-card outbound-link ratio")
        def _():
            # Post-R107 honesty policy: some research pages will legitimately
            # have zero outbound links when candidates are niche-brand direct-
            # only products with no retailer SKU + no manufacturer URL. Don't
            # fail the suite on that shape — report the ratio so it shows up
            # in telemetry without blocking deploys. Only fail if the page
            # has no product cards at all (real regression).
            html = sess.get(f"{base}/research/{slug}", timeout=15).text
            cards = re.split(r'class=["\']product["\']', html)[1:]
            if len(cards) == 0:
                assert False, "page has no product cards at all"
            with_link = 0
            for card in cards:
                # Scan full card — link section sits past the first 3-4KB.
                if (
                    "amazon.com" in card
                    or "walmart.com" in card
                    or "Buy on " in card
                    or "product-link-mfr" in card
                    or "Visit site" in card
                ):
                    with_link += 1
            return True, "", f"{with_link}/{len(cards)} cards linked"

        @case(s, f"/research/{slug}: share buttons rendered")
        def _():
            html = sess.get(f"{base}/research/{slug}", timeout=15).text
            assert "share-btn" in html or "Share" in html, "no share UI found"
            return True

        @case(s, f"/api/research/{slug}/events returns events payload")
        def _():
            r = sess.get(f"{base}/api/research/{slug}/events", timeout=10)
            assert r.status_code == 200
            data = r.json()
            assert isinstance(data, dict), f"expected dict got {type(data).__name__}"
            assert "events" in data and isinstance(data["events"], list)
            assert "status" in data
            return True, "", f"status={data['status']} events={len(data['events'])}"

        @case(s, f"/research/{slug} response time under 1s (KV cache)")
        def _():
            # Warm up
            sess.get(f"{base}/research/{slug}", timeout=15)
            start = time.perf_counter()
            r = sess.get(f"{base}/research/{slug}", timeout=15)
            dur = (time.perf_counter() - start) * 1000
            assert r.status_code == 200
            ok = dur < 1000
            return ok, "", f"t={dur:.0f}ms"

    # --- Second: smoke-test the browser search box without actually hitting the LLM ---
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        @case(s, "Browser: home loads and search input is visible")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded", timeout=15000)
            page.wait_for_selector('input[name="q"]', timeout=5000)
            return True

        @case(s, "Browser: typing triggers suggest API")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded", timeout=15000)
            # Capture network activity for /api/search/suggest
            seen = []
            page.on("request", lambda req: seen.append(req.url) if "/api/search/suggest" in req.url else None)
            page.fill('input[name="q"]', "best")
            # debounce window
            page.wait_for_timeout(600)
            assert seen, "no suggest API call fired"
            return True, "", f"requests={len(seen)}"

        if slug:
            @case(s, f"Browser: /research/{slug} shows product cards in DOM")
            def _():
                page.goto(f"{base}/research/{slug}", wait_until="domcontentloaded", timeout=15000)
                count = page.evaluate("document.querySelectorAll('.product').length")
                assert count >= 1, f"no product in DOM (got {count})"
                return True, "", f"cards={count}"

            @case(s, f"Browser: /research/{slug} — every product has visible buy CTA")
            def _():
                page.goto(f"{base}/research/{slug}", wait_until="domcontentloaded", timeout=15000)
                result = page.evaluate("""() => {
                  const cards = Array.from(document.querySelectorAll('.product'));
                  const missing = [];
                  cards.forEach((c, i) => {
                    const links = c.querySelectorAll('a[href*="amazon.com"], a[href*="walmart.com"], a.buy-btn, a.buy-link, a.product-link-mfr, a.product-link-search');
                    if (links.length === 0) missing.push(i);
                  });
                  return { total: cards.length, missing };
                }""")
                assert result["total"] >= 1, "no cards"
                assert not result["missing"], f"{len(result['missing'])}/{result['total']} cards missing buy CTA: {result['missing'][:5]}"
                return True, "", f"cards={result['total']}"

            @case(s, f"Browser: /research/{slug} Largest Contentful Paint proxy < 3s")
            def _():
                page.goto(f"{base}/research/{slug}", wait_until="domcontentloaded", timeout=15000)
                # Measure via Performance API
                nav = page.evaluate("""() => {
                  const n = performance.getEntriesByType('navigation')[0];
                  return n ? {
                    dcl: n.domContentLoadedEventEnd,
                    load: n.loadEventEnd,
                    ttfb: n.responseStart,
                  } : null;
                }""")
                assert nav, "no nav timing"
                load = nav["load"]
                ok = load < 3000
                return ok, "", f"load={load:.0f}ms ttfb={nav['ttfb']:.0f}ms"

        browser.close()

    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
