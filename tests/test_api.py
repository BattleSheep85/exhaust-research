"""API endpoint correctness tests."""
from __future__ import annotations

import requests
from suite import Suite, case


def run(base: str) -> Suite:
    s = Suite("API")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-Tests/1.0"

    @case(s, "/api/search/suggest?q=a (too short) returns []")
    def _():
        r = sess.get(f"{base}/api/search/suggest?q=a", timeout=10)
        assert r.status_code == 200
        assert r.json() == []
        return True

    @case(s, "/api/search/suggest?q=best returns JSON array")
    def _():
        r = sess.get(f"{base}/api/search/suggest?q=best", timeout=10)
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        if data:
            assert "slug" in data[0]
            assert "query" in data[0]
        return True, "", f"results={len(data)}"

    @case(s, "/api/search/suggest tolerates FTS special chars")
    def _():
        # A raw apostrophe or quote used to crash FTS5 queries
        for q in ["best wi-fi router", "women's watches", "'quoted'", "a & b"]:
            r = sess.get(f"{base}/api/search/suggest", params={"q": q}, timeout=10)
            assert r.status_code == 200, f"query={q!r} returned {r.status_code}"
            assert isinstance(r.json(), list)
        return True

    @case(s, "/api/subscribe rejects invalid email")
    def _():
        r = sess.post(f"{base}/api/subscribe", json={"email": "not-an-email", "researchId": "x"}, timeout=10)
        assert r.status_code == 400
        return True

    @case(s, "/api/subscribe rejects missing researchId")
    def _():
        r = sess.post(f"{base}/api/subscribe", json={"email": "a@b.com"}, timeout=10)
        assert r.status_code == 400
        return True

    @case(s, "/api/subscribe rejects nonexistent research")
    def _():
        r = sess.post(f"{base}/api/subscribe", json={"email": "a@b.com", "researchId": "nonexistent-xyz"}, timeout=10)
        assert r.status_code == 404
        return True

    @case(s, "/api/research/<fake>/events returns 404")
    def _():
        r = sess.get(f"{base}/api/research/does-not-exist-xyz/events", timeout=10)
        assert r.status_code == 404
        return True

    @case(s, "Methods other than GET rejected on static routes")
    def _():
        r = sess.put(f"{base}/", timeout=10)
        assert r.status_code == 405
        return True

    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
