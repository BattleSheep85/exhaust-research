"""Shared test infrastructure for chrisputer.tech end-to-end tests.

Zero-dep beyond Playwright + requests. Each test module exposes `run(base_url) -> list[Result]`.
The runner aggregates and prints a Markdown report.
"""
from __future__ import annotations

import time
import traceback
from dataclasses import dataclass, field
from typing import Callable

PROD_URL = "https://chrisputer.tech"


@dataclass
class Result:
    name: str
    status: str  # "PASS" | "FAIL" | "SKIP"
    duration_ms: float
    detail: str = ""
    metric: str = ""  # e.g. "TTFB=234ms"


@dataclass
class Suite:
    name: str
    results: list[Result] = field(default_factory=list)

    @property
    def passed(self) -> int:
        return sum(1 for r in self.results if r.status == "PASS")

    @property
    def failed(self) -> int:
        return sum(1 for r in self.results if r.status == "FAIL")

    @property
    def skipped(self) -> int:
        return sum(1 for r in self.results if r.status == "SKIP")


def case(suite: Suite, name: str):
    """Decorator to wrap a test fn — captures timing + exceptions into a Result."""
    def wrap(fn: Callable[[], tuple[bool, str, str] | tuple[bool, str] | bool]):
        start = time.perf_counter()
        try:
            ret = fn()
            if isinstance(ret, tuple) and len(ret) == 3:
                ok, detail, metric = ret
            elif isinstance(ret, tuple) and len(ret) == 2:
                ok, detail = ret
                metric = ""
            else:
                ok = bool(ret)
                detail = ""
                metric = ""
            dur = (time.perf_counter() - start) * 1000
            suite.results.append(Result(
                name=name,
                status="PASS" if ok else "FAIL",
                duration_ms=dur,
                detail=detail,
                metric=metric,
            ))
        except AssertionError as e:
            dur = (time.perf_counter() - start) * 1000
            suite.results.append(Result(
                name=name,
                status="FAIL",
                duration_ms=dur,
                detail=f"AssertionError: {e}",
            ))
        except Exception as e:
            dur = (time.perf_counter() - start) * 1000
            tb = traceback.format_exc().splitlines()[-3:]
            suite.results.append(Result(
                name=name,
                status="FAIL",
                duration_ms=dur,
                detail=f"{type(e).__name__}: {e}\n  " + "\n  ".join(tb),
            ))
        return fn
    return wrap


def fmt_suite(s: Suite) -> str:
    """Format a suite as human-readable lines."""
    lines = [f"\n## {s.name}  ({s.passed} pass / {s.failed} fail / {s.skipped} skip)"]
    for r in s.results:
        icon = {"PASS": "✓", "FAIL": "✗", "SKIP": "○"}[r.status]
        metric = f"  [{r.metric}]" if r.metric else ""
        lines.append(f"  {icon} {r.name}  ({r.duration_ms:.0f}ms){metric}")
        if r.status == "FAIL" and r.detail:
            for dl in r.detail.splitlines():
                lines.append(f"      {dl}")
    return "\n".join(lines)
