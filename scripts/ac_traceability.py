#!/usr/bin/env python3
"""Generate the acceptance-criteria traceability table.

Reads the Kanban CSV export that defines the ACs, then for each AC records:

  * the board lane it currently sits in (done / in progress / rejected),
  * every API endpoint the AC text names, resolved to the router that serves
    it, so a reviewer can jump straight to the implementation,
  * every place in the repo that tags the AC by number.

The point is to make evidence checkable rather than asserted. An AC with no
tagged reference is reported as such: that is usually a tagging gap rather
than a missing feature, but it means the evidence is not mechanically
verifiable and someone has to look.

Cards that only exist in the archived lane are superseded and are left out
unless --include-archived is passed.

The Playwright columns are the browser-level evidence: tests under e2e/ whose
title names the AC (a mention in a comment does not count). An AC that cannot
be asserted through a browser or an HTTP request is listed in
e2e/ac/manual.json with the reason and a pointer to the evidence that does
exist. --check fails when a live AC has neither.

A title is only a claim. Pass --results with one or more Playwright JSON
reports (`--reporter=json`) and each AC also gets the outcome of its tests, so
an AC whose only tests are skipped or marked fixme is reported as not passing
instead of being counted as covered.

Usage:
    python3 scripts/ac_traceability.py --csv <export.csv> [--out docs/ac-traceability.md]
        [--results mock.json real.json ...] [--check]
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SEARCH_DIRS = ["backend/app", "backend/tests", "src", "e2e", "shared"]
AC_TITLE = re.compile(r"^\s*AC\s*([\d.]+)\s*[:\-]?\s*(.*)$")
MANUAL_PATH = REPO_ROOT / "e2e/ac/manual.json"
REAL_STACK_SPECS = ("e2e/ac-real/", "e2e/real-backend.spec.ts", "e2e/real-removal-cycle.spec.ts")
ENDPOINT = re.compile(r"(GET|POST|PATCH|PUT|DELETE)\s+(/api/v1/[A-Za-z0-9/_{}-]+)")


def ac_key(value: str) -> list[int]:
    return [int(part) for part in value.split(".")]


def strip_html(raw: str) -> str:
    text = re.sub(r"<[^>]+>", "\n", raw or "")
    return re.sub(r"\n{2,}", "\n", html.unescape(text)).strip()


def load_acs(csv_path: Path) -> dict[str, dict]:
    acs: dict[str, dict] = {}
    with csv_path.open(encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            match = AC_TITLE.match(row["Card_Title"])
            if not match:
                continue
            number, title = match.group(1), match.group(2).strip()
            description = strip_html(row["Card_Description"])
            lane = row["Lane_Title"]
            existing = acs.get(number)
            # Several lanes can hold a copy of the same card. Keep the richest
            # description, and prefer a non-archived lane for the status.
            if existing is None:
                acs[number] = {
                    "title": title,
                    "description": description,
                    "lanes": {lane},
                }
                continue
            existing["lanes"].add(lane)
            if len(description) > len(existing["description"]):
                existing["description"] = description
                existing["title"] = title or existing["title"]
    return acs


def current_lane(lanes: set[str]) -> str:
    for candidate in sorted(lanes):
        if "rejected" in candidate or "blocked" in candidate:
            return candidate
    live = [lane for lane in sorted(lanes) if lane != "archived"]
    return live[0] if live else "archived"


def router_for(endpoint: str) -> str | None:
    """Resolve /api/v1/x/y to the router file that mounts it."""
    routers = sorted((REPO_ROOT / "backend/app/api/routers").glob("*.py"))
    best: tuple[int, str] | None = None
    for path in routers:
        source = path.read_text()
        for prefix in re.findall(r'prefix\s*=\s*"([^"]+)"', source):
            if endpoint.startswith(prefix) and (best is None or len(prefix) > best[0]):
                best = (len(prefix), f"backend/app/api/routers/{path.name}")
    return best[1] if best else None


def tagged_references(number: str) -> list[str]:
    pattern = rf"AC {re.escape(number)}\b"
    found = subprocess.run(
        ["grep", "-rn", "-E", pattern, *SEARCH_DIRS],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    ).stdout.splitlines()
    # Collapse to one entry per file. Line numbers go stale on the next edit
    # and a router that mentions the AC nine times is not nine pieces of
    # evidence; the count is enough to show how heavily it is referenced.
    counts: dict[str, int] = {}
    for line in found:
        parts = line.split(":", 2)
        if len(parts) < 2:
            continue
        counts[parts[0]] = counts.get(parts[0], 0) + 1
    return [
        name if count == 1 else f"{name} (x{count})"
        for name, count in sorted(counts.items())
    ]


AC_TOKEN = re.compile(r"AC (\d+(?:\.\d+)+)")
TEST_TITLE_LINE = re.compile(r"\btest(?:\.\w+)?\(")


def playwright_title_tags() -> dict[str, set[str]]:
    """AC number -> spec files with a test title that names it."""
    tags: dict[str, set[str]] = {}
    for path in sorted((REPO_ROOT / "e2e").rglob("*.spec.ts")):
        name = str(path.relative_to(REPO_ROOT))
        for line in path.read_text().splitlines():
            if not TEST_TITLE_LINE.search(line):
                continue
            for number in AC_TOKEN.findall(line):
                tags.setdefault(number, set()).add(name)
    return tags


def playwright_outcomes(reports: list[Path]) -> dict[str, dict[str, int]]:
    """AC number -> how many of its tests passed, were skipped, or failed."""
    outcomes: dict[str, dict[str, int]] = {}

    def walk(suite: dict) -> None:
        for spec in suite.get("specs", []):
            numbers = set(AC_TOKEN.findall(spec["title"]))
            for test in spec.get("tests", []):
                status = {"expected": "passed", "flaky": "passed", "skipped": "skipped"}.get(
                    test.get("status"), "failed"
                )
                for number in numbers:
                    counts = outcomes.setdefault(number, {"passed": 0, "skipped": 0, "failed": 0})
                    counts[status] += 1
        for child in suite.get("suites", []):
            walk(child)

    for report in reports:
        for suite in json.loads(report.read_text()).get("suites", []):
            walk(suite)
    return outcomes


def load_manual() -> dict[str, str]:
    if not MANUAL_PATH.exists():
        return {}
    return json.loads(MANUAL_PATH.read_text())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "docs/ac-traceability.md")
    parser.add_argument("--include-archived", action="store_true")
    parser.add_argument(
        "--results",
        nargs="*",
        type=Path,
        default=[],
        help="Playwright JSON reports; adds each AC's test outcome",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="exit 1 when an AC has neither a Playwright spec nor a manual entry",
    )
    args = parser.parse_args()

    acs = load_acs(args.csv)
    if not args.include_archived:
        acs = {number: entry for number, entry in acs.items() if entry["lanes"] != {"archived"}}
    manual = load_manual()
    title_tags = playwright_title_tags()
    outcomes = playwright_outcomes(args.results) if args.results else None
    rows = []
    for number in sorted(acs, key=ac_key):
        entry = acs[number]
        endpoints = sorted({match.group(2) for match in ENDPOINT.finditer(entry["description"])})
        implementations = sorted({r for r in (router_for(e) for e in endpoints) if r})
        refs = tagged_references(number)
        test_refs = sorted({r for r in refs if "/tests/" in r or r.startswith("e2e/") or ".test." in r or ".spec." in r})
        code_refs = sorted({r for r in refs if r not in test_refs})
        playwright_refs = sorted(title_tags.get(number, set()))
        counts = (outcomes or {}).get(number, {"passed": 0, "skipped": 0, "failed": 0})
        if outcomes is None:
            outcome = "—"
        elif not any(counts.values()):
            outcome = "not run"
        else:
            outcome = ", ".join(f"{count} {name}" for name, count in counts.items() if count)
        rows.append(
            {
                "number": number,
                "title": entry["title"],
                "lane": current_lane(entry["lanes"]),
                "endpoints": endpoints,
                "implementations": implementations,
                "code_refs": code_refs,
                "test_refs": test_refs,
                "playwright_mock": [r for r in playwright_refs if not r.startswith(REAL_STACK_SPECS)],
                "playwright_real": [r for r in playwright_refs if r.startswith(REAL_STACK_SPECS)],
                "manual": manual.get(number),
                "outcome": outcome,
                "passing": counts["passed"] > 0 and counts["failed"] == 0,
            }
        )

    untagged = [row["number"] for row in rows if not row["code_refs"] and not row["test_refs"]]
    untested = [row["number"] for row in rows if not row["test_refs"]]
    rejected = [row["number"] for row in rows if "rejected" in row["lane"]]
    in_playwright = [row["number"] for row in rows if row["playwright_mock"] or row["playwright_real"]]
    manual_only = [
        row["number"]
        for row in rows
        if row["manual"] and not (row["playwright_mock"] or row["playwright_real"])
    ]
    uncovered = [
        row["number"]
        for row in rows
        if not (row["playwright_mock"] or row["playwright_real"] or row["manual"])
    ]
    stale_manual = sorted(set(manual) - {row["number"] for row in rows}, key=ac_key)
    not_passing = [
        row["number"]
        for row in rows
        if outcomes is not None and row["number"] in in_playwright and not row["passing"]
    ]

    lines = [
        "# Acceptance-criteria traceability",
        "",
        "Generated by `scripts/ac_traceability.py` from the Kanban CSV export.",
        "Regenerate with:",
        "",
        "```bash",
        "npx playwright test --reporter=json > mock.json",
        "REAL_API_URL=<compose api> npx playwright test --config=playwright.real.config.ts --reporter=json > real.json",
        "npm run build && npx playwright test --config=playwright.pwa.config.ts --reporter=json > pwa.json",
        "python3 scripts/ac_traceability.py --csv <export.csv> --results mock.json real.json pwa.json --check",
        "```",
        "",
        "`Playwright (mocks)` is `e2e/ac/` and the journey specs: what the user sees,",
        "against the mock service worker. `Playwright (real stack)` is `e2e/ac-real/`:",
        "the server-side rule, against the Compose stack. `Test outcome` counts the",
        "tests naming the AC in the supplied runs; a skipped test is either a",
        "`test.fixme` recording a place where the app does not meet the AC, or a test",
        "whose environment was missing (no protected-area import, hosting gate off).",
        "",
        "`Tagged in code` and `Tagged in tests` list files that name the AC by",
        "number. An empty cell does not prove the behaviour is missing - most of",
        "these are tagging gaps, and the domain rules are often covered by a test",
        "that simply does not cite the number. It does mean the evidence for that",
        "row has to be established by reading, not by grep.",
        "",
        "## Summary",
        "",
        f"- Acceptance criteria defined: **{len(rows)}**",
        f"- Sitting in a rejected lane on the board: **{len(rejected)}**"
        + (f" ({', '.join(rejected)})" if rejected else ""),
        f"- With no AC-numbered reference anywhere in the repo: **{len(untagged)}**",
        f"- With no AC-numbered reference in a test or spec: **{len(untested)}**",
        f"- Named by a Playwright test title: **{len(in_playwright)}**",
        f"- Manual evidence only (`e2e/ac/manual.json`): **{len(manual_only)}**"
        + (f" ({', '.join(manual_only)})" if manual_only else ""),
        f"- Neither Playwright nor manual: **{len(uncovered)}**"
        + (f" ({', '.join(uncovered)})" if uncovered else ""),
    ]
    if outcomes is not None:
        lines.append(
            f"- Named by a test but with no passing test in the supplied runs: **{len(not_passing)}**"
            + (f" ({', '.join(not_passing)})" if not_passing else "")
        )
    lines += [
        "",
        "## Criteria",
        "",
        "| AC | Title | Board lane | API | Serving router | Tagged in code | Tagged in tests "
        "| Playwright (mocks) | Playwright (real stack) | Test outcome | Manual evidence |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        def cell(values: list[str]) -> str:
            return "<br>".join(f"`{value}`" for value in values) if values else "—"

        lines.append(
            f"| {row['number']} | {row['title']} | {row['lane']} | "
            f"{cell(row['endpoints'])} | {cell(row['implementations'])} | "
            f"{cell(row['code_refs'])} | {cell(row['test_refs'])} | "
            f"{cell(row['playwright_mock'])} | {cell(row['playwright_real'])} | "
            f"{row['outcome']} | {row['manual'] or '—'} |"
        )

    args.out.write_text("\n".join(lines) + "\n")
    out = args.out.resolve()
    shown = out.relative_to(REPO_ROOT) if out.is_relative_to(REPO_ROOT) else out
    print(f"wrote {shown} ({len(rows)} criteria)")
    print(f"rejected on board: {len(rejected)}; untagged: {len(untagged)}; untested: {len(untested)}")
    print(f"playwright: {len(in_playwright)}; manual only: {len(manual_only)}; uncovered: {len(uncovered)}")
    if outcomes is not None:
        print(f"no passing test: {len(not_passing)}" + (f" ({', '.join(not_passing)})" if not_passing else ""))
    if stale_manual:
        print(f"manual entries for ACs not on the board: {', '.join(stale_manual)}")
    if args.check and (uncovered or stale_manual):
        print("uncovered: " + ", ".join(uncovered))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
