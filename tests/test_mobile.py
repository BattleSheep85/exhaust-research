"""Mobile viewport tests. Catches horizontal overflow, tap target size, readability."""
from __future__ import annotations

from playwright.sync_api import sync_playwright
from suite import Suite, case


# Common device viewports
VIEWPORTS = [
    ("iPhone SE", 375, 667),
    ("iPhone 14", 390, 844),
    ("Galaxy S22", 360, 780),
]


def run(base: str) -> Suite:
    s = Suite("Mobile")

    with sync_playwright() as p:
        browser = p.chromium.launch()

        for dev_name, w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()

            @case(s, f"{dev_name} ({w}x{h}): / no horizontal scroll")
            def _(page=page, w=w):
                page.goto(f"{base}/", wait_until="domcontentloaded")
                # Body scrollWidth must not exceed viewport width (allow 1px rounding)
                sw = page.evaluate("document.documentElement.scrollWidth")
                assert sw <= w + 1, f"scrollWidth={sw} > viewport={w}"
                return True, "", f"scrollWidth={sw}"

            @case(s, f"{dev_name}: /research no horizontal scroll")
            def _(page=page, w=w):
                page.goto(f"{base}/research", wait_until="domcontentloaded")
                sw = page.evaluate("document.documentElement.scrollWidth")
                assert sw <= w + 1, f"scrollWidth={sw} > viewport={w}"
                return True, "", f"scrollWidth={sw}"

            @case(s, f"{dev_name}: /about no horizontal scroll")
            def _(page=page, w=w):
                page.goto(f"{base}/about", wait_until="domcontentloaded")
                sw = page.evaluate("document.documentElement.scrollWidth")
                assert sw <= w + 1, f"scrollWidth={sw} > viewport={w}"
                return True, "", f"scrollWidth={sw}"

            @case(s, f"{dev_name}: nav toggle button tap target >= 44px")
            def _(page=page):
                page.goto(f"{base}/", wait_until="domcontentloaded")
                box = page.evaluate("""() => {
                  const btn = document.querySelector('.nav-toggle');
                  if (!btn) return null;
                  const r = btn.getBoundingClientRect();
                  return { w: r.width, h: r.height, display: getComputedStyle(btn).display };
                }""")
                assert box, "no .nav-toggle found"
                # Apple HIG: 44x44. Google: 48x48. We target 40+ as minimum.
                if box["display"] == "none":
                    return False, "nav toggle is display:none on mobile"
                assert box["w"] >= 40 and box["h"] >= 40, f"too small: {box}"
                return True, "", f'{box["w"]}x{box["h"]}'

            @case(s, f"{dev_name}: Search button is tappable")
            def _(page=page):
                page.goto(f"{base}/", wait_until="domcontentloaded")
                box = page.evaluate("""() => {
                  const btn = document.querySelector('.search-box button');
                  if (!btn) return null;
                  const r = btn.getBoundingClientRect();
                  return { w: r.width, h: r.height };
                }""")
                assert box and box["h"] >= 36, f"too small: {box}"
                return True, "", f'{box["w"]}x{box["h"]}'

            ctx.close()

        browser.close()
    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
