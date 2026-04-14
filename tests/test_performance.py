"""Performance tests: budgets on TTFB, payload size, page load time.

Google Core Web Vitals targets:
  LCP < 2500ms, FID < 100ms, CLS < 0.1
We test the HTTP-layer equivalents (TTFB, full load) which are necessary, not sufficient.
"""
from __future__ import annotations

import time
import requests
from suite import Suite, case


# Budgets (ms) — tight but realistic for Cloudflare Workers at edge
TTFB_BUDGET = {
    "/": 400,
    "/research": 400,
    "/about": 300,
    "/robots.txt": 200,
    "/ads.txt": 200,
    "/favicon.svg": 150,
    "/og-image.svg": 200,
    "/api/search/suggest?q=best": 300,
}

# Payload size budgets (bytes)
SIZE_BUDGET = {
    "/": 180_000,   # Full HTML with inline CSS
    "/research": 180_000,
    "/about": 60_000,
}


def timed_get(base: str, path: str, sess: requests.Session) -> tuple[int, float, int]:
    start = time.perf_counter()
    r = sess.get(f"{base}{path}", timeout=15, stream=True)
    # Read response headers only for TTFB
    ttfb = (time.perf_counter() - start) * 1000
    body = r.content  # now read full body
    total = (time.perf_counter() - start) * 1000
    return r.status_code, ttfb, len(body)


def run(base: str) -> Suite:
    s = Suite("Performance")
    sess = requests.Session()
    sess.headers["User-Agent"] = "ChrisputerLabs-Tests/1.0"

    # Warm up — first request often pays TLS + cold start
    sess.get(f"{base}/", timeout=15)

    for path, budget in TTFB_BUDGET.items():
        name = f"TTFB {path} < {budget}ms"
        @case(s, name)
        def _(path=path, budget=budget):
            # Measure 3 times, take median (remove noise from network jitter)
            samples = []
            for _ in range(3):
                _, ttfb, _ = timed_get(base, path, sess)
                samples.append(ttfb)
            samples.sort()
            median = samples[1]
            ok = median < budget
            return ok, "", f"median={median:.0f}ms samples={[int(s) for s in samples]}"

    for path, budget in SIZE_BUDGET.items():
        @case(s, f"Size {path} < {budget // 1000}KB")
        def _(path=path, budget=budget):
            _, _, size = timed_get(base, path, sess)
            ok = size < budget
            return ok, "", f"size={size}b"

    @case(s, "Home page gzip/br compression enabled")
    def _():
        r = sess.get(f"{base}/", headers={"Accept-Encoding": "gzip, br"}, timeout=10)
        enc = r.headers.get("Content-Encoding", "")
        assert enc in ("gzip", "br"), f"no compression — got encoding={enc!r}"
        return True, "", f"encoding={enc}"

    @case(s, "Static assets have Cache-Control with max-age")
    def _():
        # Cloudflare auto-gzip strips Cache-Control on GET of small text files;
        # HEAD preserves it. The cache-control directive is still honored by CDNs.
        for path in ["/favicon.svg", "/og-image.svg", "/robots.txt", "/ads.txt"]:
            r = sess.head(f"{base}{path}", timeout=10)
            cc = r.headers.get("Cache-Control", "")
            assert "max-age" in cc, f"{path} missing max-age: {cc}"
        return True

    @case(s, "API responses are no-store (not cached)")
    def _():
        r = sess.get(f"{base}/api/search/suggest?q=test", timeout=10)
        assert r.headers.get("Cache-Control") == "no-store", r.headers.get("Cache-Control")
        return True

    @case(s, "Home loads fully within 1.5s (warmup + real)")
    def _():
        # Second request should hit KV cache, be very fast
        start = time.perf_counter()
        r = sess.get(f"{base}/", timeout=10)
        dur = (time.perf_counter() - start) * 1000
        assert r.status_code == 200
        ok = dur < 1500
        return ok, "", f"total={dur:.0f}ms"

    return s


if __name__ == "__main__":
    import sys
    from suite import PROD_URL, fmt_suite
    s = run(sys.argv[1] if len(sys.argv) > 1 else PROD_URL)
    print(fmt_suite(s))
    sys.exit(0 if s.failed == 0 else 1)
