"""SEO and meta correctness tests. Google's crawler expectations."""
from __future__ import annotations

import json
import re
import requests
from suite import Suite, case


def run(base: str) -> Suite:
    s = Suite("SEO")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-Tests/1.0"

    @case(s, "Home has canonical, OG, Twitter meta")
    def _():
        html = sess.get(f"{base}/").text
        assert '<link rel="canonical"' in html
        assert 'property="og:title"' in html
        assert 'property="og:description"' in html
        assert 'property="og:image"' in html
        assert 'name="twitter:card"' in html
        assert f'href="{base}/"' in html or 'href="https://chrisputer.tech/"' in html
        return True

    @case(s, "Home has valid WebSite JSON-LD")
    def _():
        html = sess.get(f"{base}/").text
        # Script tag now carries a CSP nonce — regex accepts optional nonce attr.
        m = re.search(r'<script type="application/ld\+json"(?:\s+nonce="[a-f0-9]+")?>(\{[^<]*?"WebSite"[^<]*?\})</script>', html)
        assert m, "no WebSite JSON-LD found"
        data = json.loads(m.group(1))
        assert data["@type"] == "WebSite"
        assert data["name"] == "Chrisputer Labs"
        assert data["url"] == "https://chrisputer.tech"
        assert "potentialAction" in data
        return True

    @case(s, "Single H1 on every main page")
    def _():
        for path in ["/", "/research", "/about"]:
            html = sess.get(f"{base}{path}").text
            h1s = re.findall(r"<h1[^>]*>", html)
            assert len(h1s) == 1, f"{path}: {len(h1s)} H1s"
        return True

    @case(s, "Sitemap lists at least homepage + browse + about")
    def _():
        xml = sess.get(f"{base}/sitemap.xml").text
        # Wrangler dev rewrites scheme to http://chrisputer.tech when simulating
        # the configured zone. Accept prod https, dev localhost, or the rewritten
        # dev variant.
        assert any(f"<loc>{origin}/</loc>" in xml for origin in [
            "https://chrisputer.tech", base, "http://chrisputer.tech"
        ])
        assert "/research</loc>" in xml
        assert "/about</loc>" in xml
        return True

    @case(s, "Meta description present and reasonable length")
    def _():
        for path in ["/", "/about", "/research"]:
            html = sess.get(f"{base}{path}").text
            m = re.search(r'<meta name="description" content="([^"]+)"', html)
            assert m, f"{path}: no meta description"
            desc = m.group(1)
            assert 20 < len(desc) < 200, f"{path}: desc len={len(desc)}"
        return True

    @case(s, "No stale 'research.chrisputer.tech' in emitted HTML")
    def _():
        for path in ["/", "/research", "/about"]:
            html = sess.get(f"{base}{path}").text
            assert "research.chrisputer.tech" not in html, f"{path} contains stale subdomain ref"
        return True

    @case(s, "No stale 'Exhaustive' branding in user-visible text")
    def _():
        # Acceptable: none. The tier is now "Deep Dive".
        for path in ["/", "/research", "/about"]:
            html = sess.get(f"{base}{path}").text
            # Strip script/style to avoid false positives from inline data
            stripped = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", html, flags=re.S)
            assert "Exhaustive" not in stripped, f"{path} contains 'Exhaustive' in user-visible text"
        return True

    @case(s, "AdSense script tag present on every page")
    def _():
        for path in ["/", "/research", "/about"]:
            html = sess.get(f"{base}{path}").text
            assert "adsbygoogle.js?client=ca-pub-6952672558994325" in html, f"{path} missing AdSense"
        return True

    @case(s, "CF Analytics beacon present on every page")
    def _():
        for path in ["/", "/research", "/about"]:
            html = sess.get(f"{base}{path}").text
            assert "cloudflareinsights.com/beacon.min.js" in html, f"{path} missing CF analytics"
        return True

    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
