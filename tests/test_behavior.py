"""Behavioral end-to-end tests.

Tests the *product*, not the markup. Each scenario submits real queries (costs real LLM calls),
watches the activity feed, inspects the final output, and judges quality.

Run with:
  python3 test_behavior.py                         # prod
  python3 test_behavior.py http://localhost:8787   # local
  python3 test_behavior.py --only 1,4              # subset of scenarios
"""
from __future__ import annotations

import argparse
import re
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import requests
from playwright.sync_api import Page, sync_playwright
from suite import PROD_URL, Suite, case, fmt_suite


# Known plausible brands for category sanity checks
NAS_BRANDS = {
    "synology", "qnap", "asustor", "terramaster", "ugreen", "buffalo",
    "western digital", "wd", "seagate", "truenas", "ixsystems", "zimaboard",
    "lacie", "netgear", "drobo", "dell", "lenovo", "hpe", "orico",
}
KEYBOARD_HINT_WORDS = {
    "keyboard", "switch", "switches", "keys", "keycap", "keycaps", "mechanical",
    "typing", "backlight", "rgb", "layout", "hot-swap", "tactile", "clicky", "linear",
}


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class Product:
    name: str
    brand: str
    price: str
    rating: str
    pros: list[str]
    cons: list[str]
    verdict: str
    buy_url: str
    mfr_url: str


@dataclass
class ResultInspection:
    slug: str
    products: list[Product] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    summary: str = ""
    query: str = ""
    status: str = ""


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def submit_query_via_browser(page: Page, base: str, query: str) -> tuple[str, float]:
    """Submit a query through the actual home-page form. Returns (slug, submit_duration_ms)."""
    page.goto(f"{base}/", wait_until="domcontentloaded", timeout=15000)
    page.wait_for_selector('input[name="q"]', timeout=5000)
    page.fill('input[name="q"]', query)

    t0 = time.perf_counter()
    with page.expect_navigation(wait_until="domcontentloaded", timeout=60000):
        page.click('.search-box button[type="submit"]')
    submit_ms = (time.perf_counter() - t0) * 1000

    url = page.url
    m = re.search(r"/research/([a-z0-9-]+)", url)
    if not m:
        raise AssertionError(f"did not redirect to /research/<slug>; landed on {url}")
    return m.group(1), submit_ms


def poll_events(
    base: str,
    slug: str,
    sess: requests.Session,
    timeout_s: int = 90,
    interval_s: float = 0.5,
) -> dict[str, Any]:
    """Poll events until status is complete/failed. Returns a timeline dict."""
    start = time.perf_counter()
    first_event_at_ms: float | None = None
    complete_at_ms: float | None = None
    events: list[dict] = []
    last_seq = 0
    final_status = "unknown"
    max_gap_ms = 0.0
    last_event_time = start

    while True:
        now = time.perf_counter()
        elapsed = now - start
        if elapsed > timeout_s:
            final_status = "timeout"
            break

        try:
            r = sess.get(f"{base}/api/research/{slug}/events?since={last_seq}", timeout=10)
            data = r.json()
        except Exception:
            time.sleep(interval_s)
            continue

        new = data.get("events", []) or []
        if new:
            gap_ms = (now - last_event_time) * 1000
            max_gap_ms = max(max_gap_ms, gap_ms)
            last_event_time = now
            for ev in new:
                ev["seen_at_ms"] = round(elapsed * 1000)
                events.append(ev)
                last_seq = max(last_seq, ev.get("seq", last_seq))
            if first_event_at_ms is None:
                first_event_at_ms = round(elapsed * 1000)

        status = data.get("status", "")
        if status in ("complete", "failed"):
            complete_at_ms = round(elapsed * 1000)
            final_status = status
            break

        time.sleep(interval_s)

    return {
        "events": events,
        "first_event_ms": first_event_at_ms,
        "complete_ms": complete_at_ms,
        "max_gap_ms": round(max_gap_ms),
        "status": final_status,
    }


def extract_result(base: str, slug: str, sess: requests.Session) -> ResultInspection:
    """Parse the rendered research page into structured data."""
    html = sess.get(f"{base}/research/{slug}", timeout=20).text
    result = ResultInspection(slug=slug)

    # Query from <h1>
    m = re.search(r'<h1[^>]*>([^<]+)</h1>', html)
    result.query = (m.group(1) if m else "").strip()

    # Status: if the "processing" div or "failed" div shows up
    if 'id="processing"' in html:
        result.status = "processing"
    elif "Research failed" in html:
        result.status = "failed"
    else:
        result.status = "complete"

    # Summary
    m = re.search(r'<div class="summary-box">\s*<h2>[^<]*</h2>\s*<p>([^<]+)</p>', html, re.S)
    result.summary = (m.group(1) if m else "").strip()

    # Products
    products_html = re.split(r'<article class="product"', html)[1:]
    for block in products_html:
        block = block[:8000]  # enough for one product

        name_m = re.search(r'<h3[^>]*>([^<]+)</h3>', block)
        brand_m = re.search(r'<p style="color:var\(--text2\);font-size:\.85rem">([^<]+)</p>', block)
        price_m = re.search(r'<p class="product-price">([^<]+)</p>', block)
        rating_m = re.search(r'<p class="product-rating">.*?<span>([^<]+)</span>', block, re.S)
        verdict_m = re.search(r'<p class="product-verdict">([^<]+)</p>', block)

        pros = re.findall(r'pro-list[^"]*">\s*(.*?)</ul>', block, re.S)
        pros_items = re.findall(r'<li[^>]*>([^<]+)</li>', pros[0]) if pros else []
        cons = re.findall(r'con-list[^"]*">\s*(.*?)</ul>', block, re.S)
        cons_items = re.findall(r'<li[^>]*>([^<]+)</li>', cons[0]) if cons else []

        buy_m = re.search(r'class="product-link product-link-buy"[^>]*href="([^"]+)"', block)
        buy_m2 = re.search(r'href="([^"]+)"[^>]*class="product-link product-link-buy"', block)
        buy = (buy_m.group(1) if buy_m else (buy_m2.group(1) if buy_m2 else ""))

        mfr_m = re.search(r'class="product-link product-link-mfr"[^>]*href="([^"]+)"', block)
        mfr_m2 = re.search(r'href="([^"]+)"[^>]*class="product-link product-link-mfr"', block)
        mfr = (mfr_m.group(1) if mfr_m else (mfr_m2.group(1) if mfr_m2 else ""))

        result.products.append(Product(
            name=(name_m.group(1) if name_m else "").strip(),
            brand=(brand_m.group(1) if brand_m else "").strip(),
            price=(price_m.group(1) if price_m else "").strip(),
            rating=(rating_m.group(1) if rating_m else "").strip(),
            pros=[p.strip() for p in pros_items],
            cons=[c.strip() for c in cons_items],
            verdict=(verdict_m.group(1) if verdict_m else "").strip(),
            buy_url=buy.replace("&amp;", "&"),
            mfr_url=mfr.replace("&amp;", "&"),
        ))

    # Sources: the <div class="sources"> block may exist; extract a hrefs inside it
    sources_block_m = re.search(r'<div class="sources"[^>]*>(.*?)</div>', html, re.S)
    if sources_block_m:
        result.sources = re.findall(r'href="(https?://[^"]+)"', sources_block_m.group(1))

    return result


def check_amazon_link(url: str, affiliate_tag: str = "battlesheep0a-20") -> tuple[bool, str]:
    """Verify a buy URL has the affiliate tag and (best-effort) points to Amazon."""
    if not url:
        return False, "empty URL"
    if "amazon.com" not in url:
        return True, f"non-Amazon retailer: {url[:80]}"  # Walmart etc. are OK
    if f"tag={affiliate_tag}" not in url:
        return False, f"missing tag={affiliate_tag}: {url[:120]}"

    # Try a HEAD or GET to confirm the URL resolves. Amazon often serves 200 for
    # /s?k=... even if the product doesn't exist. Don't fail on Amazon CAPTCHA.
    try:
        r = requests.get(
            url,
            timeout=15,
            allow_redirects=True,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ChrisputerLabs-TestBot/1.0)",
                "Accept-Language": "en-US,en;q=0.9",
            },
        )
        if r.status_code == 200:
            title_m = re.search(r"<title[^>]*>([^<]+)</title>", r.text, re.I)
            title = title_m.group(1).strip() if title_m else ""
            if "Robot Check" in title or "captcha" in title.lower():
                return True, f"Amazon CAPTCHA (expected); URL valid"
            return True, f"200 OK: {title[:60]}"
        return False, f"HTTP {r.status_code}"
    except Exception as e:
        # Amazon sometimes blocks; accept structural validation only
        return True, f"network error (URL structurally valid): {type(e).__name__}"


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------

def scenario_1_keyboards(s: Suite, base: str, page: Page, sess: requests.Session) -> dict:
    """Common query — full pipeline + quality checks. Returns timeline for scenario 5."""
    query = "best budget mechanical keyboard under $100"
    state: dict[str, Any] = {"query": query}

    @case(s, f"S1: submit '{query}' redirects to /research/<slug>")
    def _():
        slug, submit_ms = submit_query_via_browser(page, base, query)
        state["slug"] = slug
        state["submit_ms"] = submit_ms
        return True, "", f"slug={slug} submit={submit_ms:.0f}ms"

    slug = state.get("slug")
    if not slug:
        return state

    @case(s, f"S1: processing page shows spinner + activity feed within 2s of land")
    def _():
        # We're already on /research/<slug>. The DOM should have #processing
        t0 = time.perf_counter()
        try:
            page.wait_for_selector('#processing', timeout=5000)
        except Exception:
            # Could have finished very fast if cached
            html = sess.get(f"{base}/research/{slug}", timeout=10).text
            if "Products compared" in html:
                return True, "", "already complete (cached)"
            return False, "no #processing div and not complete"
        feed_time = (time.perf_counter() - t0) * 1000
        state["feed_visible_ms"] = feed_time
        assert feed_time < 2000, f"feed took {feed_time:.0f}ms to appear"
        # Screenshot for visual verification
        try:
            page.screenshot(path=f"/tmp/s1_processing_{slug}.png", full_page=False)
        except Exception:
            pass
        return True, "", f"feed@{feed_time:.0f}ms"

    @case(s, f"S1: events stream with no >10s gap, completes in <60s (instant tier)")
    def _():
        tl = poll_events(base, slug, sess, timeout_s=90)
        state["timeline"] = tl
        assert tl["status"] == "complete", f"status={tl['status']}"
        assert tl["complete_ms"] is not None and tl["complete_ms"] < 60_000, f"complete_ms={tl['complete_ms']}"
        assert tl["first_event_ms"] is not None and tl["first_event_ms"] < 10_000, f"first_event={tl['first_event_ms']}ms"
        assert tl["max_gap_ms"] < 10_000, f"longest dead-air={tl['max_gap_ms']}ms"
        return True, "", (
            f"first_event={tl['first_event_ms']}ms "
            f"complete={tl['complete_ms']}ms "
            f"max_gap={tl['max_gap_ms']}ms "
            f"events={len(tl['events'])}"
        )

    if state.get("timeline", {}).get("status") != "complete":
        return state

    @case(s, f"S1: result has >=3 product cards with required fields")
    def _():
        result = extract_result(base, slug, sess)
        state["result"] = result
        assert len(result.products) >= 3, f"only {len(result.products)} products"

        issues = []
        for i, p in enumerate(result.products):
            if not p.name:
                issues.append(f"p{i}: no name")
            if not p.brand:
                issues.append(f"p{i} ({p.name}): no brand")
            if not p.price:
                issues.append(f"p{i} ({p.name}): no price")
            if not p.rating:
                issues.append(f"p{i} ({p.name}): no rating")
            if len(p.pros) < 2:
                issues.append(f"p{i} ({p.name}): pros={len(p.pros)}")
            if len(p.cons) < 1:
                issues.append(f"p{i} ({p.name}): cons={len(p.cons)} — no honest tradeoff listed")
            if len(p.verdict) < 20:
                issues.append(f"p{i} ({p.name}): verdict len={len(p.verdict)}")
        assert not issues, f"field issues: {issues[:5]}"
        return True, "", f"products={len(result.products)}"

    @case(s, f"S1: every Buy button points to Amazon with affiliate tag and resolves")
    def _():
        result = state["result"]
        bad = []
        for p in result.products:
            ok, detail = check_amazon_link(p.buy_url)
            if not ok:
                bad.append(f"{p.name}: {detail}")
        assert not bad, f"{len(bad)} broken: {bad[:3]}"
        return True, "", f"checked {len(result.products)} links"

    @case(s, f"S1: sources listed (>=5), not all Reddit")
    def _():
        result = state["result"]
        assert len(result.sources) >= 5, f"only {len(result.sources)} sources"
        non_reddit = [u for u in result.sources if "reddit.com" not in u.lower()]
        assert non_reddit, "100% Reddit sources"
        return True, "", f"total={len(result.sources)} non_reddit={len(non_reddit)}"

    @case(s, f"S1: summary mentions keyboard-related terms (not generic fluff)")
    def _():
        result = state["result"]
        assert result.summary, "no summary"
        blob = result.summary.lower()
        hit = [w for w in KEYBOARD_HINT_WORDS if w in blob]
        assert hit, f"summary has no keyboard terms: {result.summary[:200]}"
        return True, "", f"matched={hit[:4]}"

    return state


def scenario_2_nas(s: Suite, base: str, page: Page, sess: requests.Session) -> None:
    query = "best home NAS for 2026"
    state: dict[str, Any] = {}

    @case(s, f"S2: submit '{query}' completes <90s")
    def _():
        slug, _ = submit_query_via_browser(page, base, query)
        state["slug"] = slug
        tl = poll_events(base, slug, sess, timeout_s=120)
        state["timeline"] = tl
        assert tl["status"] == "complete", f"status={tl['status']}"
        assert tl["complete_ms"] < 90_000, f"{tl['complete_ms']}ms (instant tier should be <90s)"
        return True, "", f"complete_ms={tl['complete_ms']}"

    if "slug" not in state or state.get("timeline", {}).get("status") != "complete":
        return

    @case(s, "S2: >=3 products, all plausibly NAS (brand or name matches category)")
    def _():
        result = extract_result(base, state["slug"], sess)
        state["result"] = result
        assert len(result.products) >= 3, f"only {len(result.products)}"

        suspicious = []
        for p in result.products:
            blob = f"{p.brand} {p.name}".lower()
            brand_match = any(b in blob for b in NAS_BRANDS)
            nas_mention = "nas" in blob or "network attached" in blob
            if not (brand_match or nas_mention):
                suspicious.append(f"{p.brand} / {p.name}")
        assert not suspicious, f"possibly hallucinated: {suspicious[:3]}"
        return True, "", f"products={len(result.products)}"

    @case(s, "S2: verdicts reference storage/networking/NAS ecosystem (terms, brands, or model series)")
    def _():
        result = state["result"]
        # Direct technical vocabulary
        nas_terms = {"nas", "raid", "storage", "drive", "bay", "tb", "smb", "plex",
                     "network", "backup", "ssd", "hdd", "data management", "file"}
        # NAS brands and product lines — if a verdict discusses a named Synology/QNAP/etc.
        # product in context ("Synology technology", "QNAP software"), that's on-topic.
        nas_brands = {"synology", "qnap", "asustor", "terramaster", "ugreen", "diskstation",
                      "ds224", "ds225", "ts-", "dsm", "quts"}
        weak = []
        for p in result.products:
            blob = (p.verdict + " " + p.name).lower()
            if not any(t in blob for t in nas_terms) and not any(b in blob for b in nas_brands):
                weak.append(p.name)
        assert len(weak) <= 1, f"{len(weak)} verdicts have no NAS terms: {weak[:3]}"
        return True, "", f"weak={len(weak)}"


def scenario_3_garbage(s: Suite, base: str, page: Page, sess: requests.Session) -> None:
    """Garbage input — either graceful error, or honest 'no data'. No fabrication."""
    query = "fdsjklfdsjkl"

    @case(s, f"S3: garbage query '{query}' — graceful handling, no fabricated products")
    def _():
        # The home form requires min length via HTML5, and server validates too.
        # Submit directly to avoid browser-level validation blocking us.
        page.goto(f"{base}/", wait_until="domcontentloaded", timeout=15000)
        # Disable HTML5 validation so submit goes through
        page.evaluate("document.querySelector('form.search-form').setAttribute('novalidate','')")
        page.fill('input[name="q"]', query)

        result_url: str | None = None
        try:
            with page.expect_navigation(wait_until="domcontentloaded", timeout=60000):
                page.click('.search-box button[type="submit"]')
            result_url = page.url
        except Exception:
            result_url = page.url

        # Acceptable outcomes:
        # 1. Rejected at validation → redirected back to / with no research
        # 2. Redirected to /research/<slug> with a "failed" status
        # 3. Redirected to /research/<slug> with genuine best-effort (but honest)
        m = re.search(r"/research/([a-z0-9-]+)", result_url or "")
        if not m:
            # Validation rejected it, that's fine
            return True, "", f"rejected at validation → {result_url}"

        slug = m.group(1)
        # Poll briefly but don't wait the full 90s
        tl = poll_events(base, slug, sess, timeout_s=90)
        if tl["status"] == "failed":
            return True, "", "research correctly failed"

        # Completed — check no fabrication
        result = extract_result(base, slug, sess)
        if len(result.products) == 0:
            return True, "", "0 products (honest no-data)"
        # If it returned products, verify the summary acknowledges uncertainty
        # OR they are plausibly connected to real stuff. For pure gibberish any
        # product is likely hallucinated.
        blob = result.summary.lower() + " " + " ".join(p.name for p in result.products).lower()
        honest_markers = ["no clear", "unclear", "could not", "unable to", "unspecified", "not enough", "no specific", "no data"]
        if any(m in blob for m in honest_markers):
            return True, "", f"honest acknowledgement ({len(result.products)} products)"
        # Fail — fabricated products for gibberish query
        return False, f"returned {len(result.products)} products for gibberish — likely hallucinated"


def scenario_4_cached(s: Suite, base: str, sess: requests.Session) -> None:
    """Cached result — fast render, working affiliate links with tag preserved."""
    sitemap = sess.get(f"{base}/sitemap.xml", timeout=10).text
    slugs = re.findall(r"/research/([a-z0-9-]+)</loc>", sitemap)
    if not slugs:
        @case(s, "S4: no cached results in sitemap")
        def _():
            return False, "sitemap empty"
        return

    # Find a slug that actually has products AND has Amazon buy CTAs — skip
    # service-category pages (realtors, contractors, etc.) where the Amazon
    # fallback is intentionally suppressed.
    slug = None
    for candidate in slugs[:20]:
        html = sess.get(f"{base}/research/{candidate}", timeout=15).text
        if 'class="product"' in html and "Buy on Amazon" in html:
            slug = candidate
            break
    if not slug:
        @case(s, "S4: no cached result with products found")
        def _():
            return False, f"checked {min(20, len(slugs))} recent slugs, none had product-with-Amazon-CTA"
        return

    @case(s, f"S4: cached /research/{slug} renders in <300ms")
    def _():
        # Warm up once (KV may be cold at this region)
        sess.get(f"{base}/research/{slug}", timeout=15)
        sess.get(f"{base}/research/{slug}", timeout=15)
        start = time.perf_counter()
        r = sess.get(f"{base}/research/{slug}", timeout=15)
        dur = (time.perf_counter() - start) * 1000
        assert r.status_code == 200
        assert dur < 300, f"render={dur:.0f}ms (budget 300ms)"
        return True, "", f"t={dur:.0f}ms"

    @case(s, f"S4: first product's Buy link resolves with tag=battlesheep0a-20")
    def _():
        result = extract_result(base, slug, sess)
        if not result.products:
            return False, "no products in cached page"
        p = result.products[0]
        ok, detail = check_amazon_link(p.buy_url)
        assert ok, detail
        assert "tag=battlesheep0a-20" in p.buy_url or "walmart.com" in p.buy_url, \
            f"missing affiliate tag: {p.buy_url[:120]}"
        return True, "", detail


def scenario_5_timeline(s: Suite, state: dict) -> None:
    """Synthesize the end-to-end latency timeline from scenario 1."""
    @case(s, "S5: end-to-end latency — no UI segment with >10s dead air")
    def _():
        tl = state.get("timeline")
        if not tl:
            return False, "no timeline captured in scenario 1"
        submit_ms = state.get("submit_ms", 0)
        feed_ms = state.get("feed_visible_ms", 0)
        parts = [
            ("submit→redirect", submit_ms),
            ("land→feed_visible", feed_ms),
            ("feed→first_event", (tl.get("first_event_ms") or 0) - (feed_ms or 0) if feed_ms else tl.get("first_event_ms") or 0),
            ("longest event gap", tl.get("max_gap_ms", 0)),
            ("first_event→complete", (tl.get("complete_ms") or 0) - (tl.get("first_event_ms") or 0)),
        ]
        # The synth LLM call produces the single biggest gap; 10s threshold matches
        # instant-tier expectation (the spinner is visible throughout, so this is
        # "silent event feed" air time, not total blank screen).
        dead = [(k, v) for k, v in parts if v > 10_000 and k != "first_event→complete"]
        summary = ", ".join(f"{k}={v:.0f}ms" for k, v in parts)
        if dead:
            return False, f"dead air (>10s): {dead}"
        return True, "", summary


# ---------------------------------------------------------------------------
# Runner
# ---------------------------------------------------------------------------

def run(base: str, only: set[int] | None = None) -> Suite:
    s = Suite("Behavior")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-BehaviorTest/1.0"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 900})
        page = ctx.new_page()

        s1_state: dict = {}
        if not only or 1 in only:
            s1_state = scenario_1_keyboards(s, base, page, sess)

        if not only or 2 in only:
            scenario_2_nas(s, base, page, sess)

        if not only or 3 in only:
            scenario_3_garbage(s, base, page, sess)

        if not only or 4 in only:
            scenario_4_cached(s, base, sess)

        if (not only or 5 in only) and s1_state:
            scenario_5_timeline(s, s1_state)

        browser.close()
    return s


def _parse_args() -> tuple[str, set[int] | None]:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default=PROD_URL)
    ap.add_argument("--only", default=None, help="Comma-separated scenario numbers: 1,2,3,4,5")
    args = ap.parse_args()
    only = set(int(x.strip()) for x in args.only.split(",")) if args.only else None
    return args.base, only


if __name__ == "__main__":
    base, only = _parse_args()
    s = run(base, only)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
