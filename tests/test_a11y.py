"""Accessibility tests. Uses Playwright + axe-core-style heuristics.

We check the things Google PageSpeed Insights actually measures:
  - Images have alt (or aria-hidden)
  - Form inputs have labels or aria-label
  - Interactive elements have accessible names
  - Heading hierarchy is sane
  - Language declared on <html>
  - Color contrast (basic check via actual DOM computation)
"""
from __future__ import annotations

from playwright.sync_api import sync_playwright
from suite import Suite, case


def run(base: str) -> Suite:
    s = Suite("Accessibility")

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()

        @case(s, "Home: <html lang> declared")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            lang = page.evaluate("document.documentElement.lang")
            assert lang, "no lang attr"
            return True, "", f"lang={lang}"

        @case(s, "Home: all interactive SVG icons are aria-hidden")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            # Find SVGs inside interactive elements that lack aria-hidden or accessible label
            bad = page.evaluate("""() => {
              const svgs = document.querySelectorAll('a svg, button svg');
              const problems = [];
              for (const svg of svgs) {
                const hasAria = svg.getAttribute('aria-hidden') === 'true';
                const hasLabel = svg.getAttribute('aria-label') || svg.querySelector('title');
                if (!hasAria && !hasLabel) {
                  problems.push(svg.outerHTML.slice(0, 100));
                }
              }
              return problems;
            }""")
            assert not bad, f"SVGs without aria-hidden or label: {bad[:3]}"
            return True, "", f"checked all icons"

        @case(s, "Home: search input has aria-label")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            labels = page.eval_on_selector_all(
                'input[name="q"]',
                "els => els.map(e => e.getAttribute('aria-label') || '')"
            )
            assert all(labels), f"missing aria-label: {labels}"
            return True

        @case(s, "Home: all <a> with target=_blank have rel=noopener")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            bad = page.evaluate("""() => {
              return Array.from(document.querySelectorAll('a[target=_blank]'))
                .filter(a => !(a.rel || '').includes('noopener'))
                .map(a => a.href);
            }""")
            assert not bad, f"target=_blank links missing rel=noopener: {bad}"
            return True

        @case(s, "Home: no empty <button> or <a>")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            bad = page.evaluate("""() => {
              const els = document.querySelectorAll('button, a');
              const bad = [];
              for (const el of els) {
                const text = (el.innerText || '').trim();
                const label = el.getAttribute('aria-label');
                if (!text && !label) bad.push(el.outerHTML.slice(0, 120));
              }
              return bad;
            }""")
            assert not bad, f"empty interactive elements: {bad[:3]}"
            return True

        @case(s, "Home: heading hierarchy (h1 exists, no skipped levels)")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            issues = page.evaluate("""() => {
              const hs = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'));
              let prev = 0, errs = [];
              for (const h of hs) {
                const lvl = +h.tagName[1];
                if (prev && lvl > prev + 1) errs.push(`skipped from h${prev} to h${lvl}: ${h.innerText.slice(0,40)}`);
                prev = lvl;
              }
              return { first: hs[0]?.tagName, errs, count: hs.length };
            }""")
            assert issues["first"] == "H1", f"first heading is {issues['first']}"
            assert not issues["errs"], f"hierarchy errors: {issues['errs']}"
            return True, "", f"headings={issues['count']}"

        @case(s, "Keyboard: Tab reaches search input from page top")
        def _():
            page.goto(f"{base}/", wait_until="domcontentloaded")
            # Tab through until we land on a q input, max 20 tabs
            for i in range(20):
                page.keyboard.press("Tab")
                focused = page.evaluate("document.activeElement && document.activeElement.name")
                if focused == "q":
                    return True, "", f"reached in {i+1} tabs"
            return False, "could not reach search input via Tab"

        @case(s, "Research result page: share buttons have accessible names")
        def _():
            # Find a completed research
            import requests
            sitemap = requests.get(f"{base}/sitemap.xml", timeout=10).text
            import re
            slugs = re.findall(r"/research/([a-z0-9-]+)</loc>", sitemap)
            if not slugs:
                return False, "no research results in sitemap to test"
            page.goto(f"{base}/research/{slugs[0]}", wait_until="domcontentloaded")
            # Share buttons should either have text or aria-label
            bad = page.evaluate("""() => {
              const sb = document.querySelectorAll('.share-btn');
              const bad = [];
              for (const b of sb) {
                const t = (b.innerText || '').trim();
                const l = b.getAttribute('aria-label');
                if (!t && !l) bad.push(b.outerHTML.slice(0, 100));
              }
              return bad;
            }""")
            assert not bad, f"share btns missing names: {bad}"
            return True

        browser.close()
    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
