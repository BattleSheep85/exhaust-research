"""Smoke tests: every URL returns the expected status, with the expected shape."""
from __future__ import annotations

import requests
from suite import Suite, case


def run(base: str) -> Suite:
    s = Suite("Smoke")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-Tests/1.0"

    @case(s, "GET / returns 200 with Chrisputer Labs title")
    def _():
        r = sess.get(f"{base}/", timeout=10)
        assert r.status_code == 200, f"status={r.status_code}"
        assert "Chrisputer Labs" in r.text, "title missing"
        assert "Exhaustive" not in r.text.replace("Exhaustive tier", ""), "stale 'Exhaustive' branding"
        return True, "", f"bytes={len(r.content)}"

    @case(s, "GET /research returns 200")
    def _():
        r = sess.get(f"{base}/research", timeout=10)
        assert r.status_code == 200
        assert "Browse research" in r.text
        return True

    @case(s, "GET /about returns 200 with rewritten copy")
    def _():
        r = sess.get(f"{base}/about", timeout=10)
        assert r.status_code == 200
        assert "About Chrisputer Labs" in r.text
        assert "20+ years in IT" in r.text
        return True

    @case(s, "GET /robots.txt references sitemap")
    def _():
        r = sess.get(f"{base}/robots.txt", timeout=10)
        assert r.status_code == 200
        assert "Sitemap:" in r.text
        assert r.headers.get("Content-Type", "").startswith("text/plain")
        return True

    @case(s, "GET /ads.txt has correct AdSense publisher ID")
    def _():
        r = sess.get(f"{base}/ads.txt", timeout=10)
        assert r.status_code == 200
        assert "pub-6952672558994325" in r.text
        assert "google.com" in r.text
        return True, r.text.strip()

    @case(s, "GET /sitemap.xml returns valid XML")
    def _():
        r = sess.get(f"{base}/sitemap.xml", timeout=10)
        assert r.status_code == 200
        assert "<?xml" in r.text
        assert "<urlset" in r.text
        return True

    @case(s, "GET /favicon.svg returns SVG")
    def _():
        r = sess.get(f"{base}/favicon.svg", timeout=10)
        assert r.status_code == 200
        assert r.headers.get("Content-Type", "").startswith("image/svg")
        assert "CL" in r.text, "favicon should show CL"
        return True

    @case(s, "GET /og-image.svg returns SVG")
    def _():
        r = sess.get(f"{base}/og-image.svg", timeout=10)
        assert r.status_code == 200
        assert "Chrisputer Labs" in r.text
        return True

    @case(s, "GET /research/nonexistent-slug returns 404")
    def _():
        r = sess.get(f"{base}/research/this-slug-does-not-exist-zzz", timeout=10, allow_redirects=False)
        assert r.status_code == 404, f"got {r.status_code}"
        return True

    @case(s, "GET /nonexistent-page returns 404")
    def _():
        r = sess.get(f"{base}/totally-fake-page", timeout=10, allow_redirects=False)
        assert r.status_code == 404
        return True

    @case(s, "POST /api/research rejects invalid JSON")
    def _():
        r = sess.post(f"{base}/api/research", data="not json", headers={"Content-Type": "application/json"}, timeout=10)
        assert r.status_code == 400
        return True

    @case(s, "POST /api/research rejects short query")
    def _():
        r = sess.post(
            f"{base}/api/research",
            json={"query": "ab", "tier": "instant"},
            headers={"Origin": base},
            timeout=10,
        )
        assert r.status_code == 400, f"got {r.status_code}"
        assert "3-500" in r.json().get("error", "")
        return True

    @case(s, "POST /api/research rejects bad Origin")
    def _():
        r = sess.post(
            f"{base}/api/research",
            json={"query": "best USB-C hub"},
            headers={"Origin": "https://evil.example.com"},
            timeout=10,
        )
        assert r.status_code == 403, f"got {r.status_code}"
        return True

    @case(s, "research.chrisputer.tech redirects 301 → chrisputer.tech")
    def _():
        r = requests.get("https://research.chrisputer.tech/about", allow_redirects=False, timeout=10)
        assert r.status_code == 301, f"got {r.status_code}"
        loc = r.headers.get("Location", "")
        assert loc == "https://chrisputer.tech/about", f"got location={loc}"
        return True

    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
