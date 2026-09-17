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

Usage:
    python3 scripts/ac_traceability.py --csv <export.csv> [--out docs/ac-traceability.md]
"""

from __future__ import annotations

import argparse
import csv
import html
import re
import subprocess
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
SEARCH_DIRS = ["backend/app", "backend/tests", "src", "e2e", "shared"]
AC_TITLE = re.compile(r"^\s*AC\s*([\d.]+)\s*[:\-]?\s*(.*)$")
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=REPO_ROOT / "docs/ac-traceability.md")
    args = parser.parse_args()

    acs = load_acs(args.csv)
    rows = []
    for number in sorted(acs, key=ac_key):
        entry = acs[number]
        endpoints = sorted({match.group(2) for match in ENDPOINT.finditer(entry["description"])})
        implementations = sorted({r for r in (router_for(e) for e in endpoints) if r})
        refs = tagged_references(number)
        test_refs = sorted({r for r in refs if "/tests/" in r or r.startswith("e2e/") or ".test." in r or ".spec." in r})
        code_refs = sorted({r for r in refs if r not in test_refs})
        rows.append(
            {
                "number": number,
                "title": entry["title"],
                "lane": current_lane(entry["lanes"]),
                "endpoints": endpoints,
                "implementations": implementations,
                "code_refs": code_refs,
                "test_refs": test_refs,
            }
        )

    untagged = [row["number"] for row in rows if not row["code_refs"] and not row["test_refs"]]
    untested = [row["number"] for row in rows if not row["test_refs"]]
    rejected = [row["number"] for row in rows if "rejected" in row["lane"]]

    lines = [
        "# Acceptance-criteria traceability",
        "",
        "Generated by `scripts/ac_traceability.py` from the Kanban CSV export.",
        "Regenerate with:",
        "",
        "```bash",
        "python3 scripts/ac_traceability.py --csv <export.csv>",
        "```",
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
        "",
        "## Criteria",
        "",
        "| AC | Title | Board lane | API | Serving router | Tagged in code | Tagged in tests |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        def cell(values: list[str]) -> str:
            return "<br>".join(f"`{value}`" for value in values) if values else "—"

        lines.append(
            f"| {row['number']} | {row['title']} | {row['lane']} | "
            f"{cell(row['endpoints'])} | {cell(row['implementations'])} | "
            f"{cell(row['code_refs'])} | {cell(row['test_refs'])} |"
        )

    args.out.write_text("\n".join(lines) + "\n")
    print(f"wrote {args.out.relative_to(REPO_ROOT)} ({len(rows)} criteria)")
    print(f"rejected on board: {len(rejected)}; untagged: {len(untagged)}; untested: {len(untested)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
