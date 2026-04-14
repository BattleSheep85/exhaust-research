"""Aggregated test runner for chrisputer.tech.

Runs every test module, aggregates results, prints a Markdown report.
Exit code is 0 only if every suite passes.

Usage:
  python3 run_all.py                         # prod
  python3 run_all.py http://localhost:8787   # local dev
  python3 run_all.py --only smoke,api        # subset
"""
from __future__ import annotations

import argparse
import importlib
import sys
import time
from typing import Callable

from suite import PROD_URL, Suite, fmt_suite


# Declared order controls run order. Faster/cheaper suites first so we fail fast.
ALL_SUITES: list[tuple[str, str]] = [
    ("smoke", "test_smoke"),
    ("api", "test_api"),
    ("seo", "test_seo"),
    ("performance", "test_performance"),
    ("a11y", "test_a11y"),
    ("mobile", "test_mobile"),
    ("flow", "test_flow"),
]


def parse_args() -> tuple[str, set[str] | None]:
    ap = argparse.ArgumentParser()
    ap.add_argument("base", nargs="?", default=PROD_URL, help="Base URL to test against")
    ap.add_argument("--only", default=None, help="Comma-separated suite keys: smoke,api,seo,performance,a11y,mobile,flow")
    args = ap.parse_args()
    only = set(x.strip() for x in args.only.split(",")) if args.only else None
    return args.base, only


def run_one(module_name: str, base: str) -> Suite:
    mod = importlib.import_module(module_name)
    run_fn: Callable[[str], Suite] = mod.run
    return run_fn(base)


def main() -> int:
    base, only = parse_args()
    print(f"# Test run against {base}")
    print(f"_started: {time.strftime('%Y-%m-%d %H:%M:%S')}_\n")

    start = time.perf_counter()
    suites: list[Suite] = []
    for key, mod in ALL_SUITES:
        if only and key not in only:
            continue
        print(f"--- running {key} ---", flush=True)
        suite_start = time.perf_counter()
        try:
            s = run_one(mod, base)
        except Exception as e:
            s = Suite(name=mod)
            from suite import Result
            s.results.append(Result(name=f"{mod} failed to load", status="FAIL", duration_ms=0, detail=str(e)))
        dur = time.perf_counter() - suite_start
        print(fmt_suite(s))
        print(f"  (suite took {dur:.1f}s)")
        suites.append(s)

    total = time.perf_counter() - start
    total_pass = sum(s.passed for s in suites)
    total_fail = sum(s.failed for s in suites)
    total_skip = sum(s.skipped for s in suites)

    print("\n" + "=" * 60)
    print(f"# Summary")
    print(f"- Total: {total_pass + total_fail + total_skip} tests")
    print(f"- **Pass**: {total_pass}")
    print(f"- **Fail**: {total_fail}")
    print(f"- Skip: {total_skip}")
    print(f"- Wall time: {total:.1f}s")

    # Top-5 slowest cases — helps the user's "takes way too long" complaint
    all_results = [(s.name, r) for s in suites for r in s.results]
    slowest = sorted(all_results, key=lambda sr: sr[1].duration_ms, reverse=True)[:5]
    print("\n## Slowest cases")
    for suite_name, r in slowest:
        print(f"  {r.duration_ms:7.0f}ms  [{suite_name}] {r.name}")

    # Failure list up top
    fails = [(s.name, r) for s in suites for r in s.results if r.status == "FAIL"]
    if fails:
        print("\n## Failures")
        for suite_name, r in fails:
            print(f"  ✗ [{suite_name}] {r.name}")
            if r.detail:
                for line in r.detail.splitlines()[:4]:
                    print(f"      {line}")

    return 0 if total_fail == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
