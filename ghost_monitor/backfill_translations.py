from __future__ import annotations

import json
from pathlib import Path

from .scorer import analyze
from .translator import translate_rows

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    rows = []
    for path in sorted((ROOT / "samples").glob("*.json")):
        rows.append(analyze(json.loads(path.read_text())).to_dict())
    cases = ROOT / "data/backfill_cases.json"
    if cases.exists():
        for case in json.loads(cases.read_text()):
            rows.append({
                "title": case.get("title", ""),
                "summary": case.get("narrative", ""),
            })
    auto = ROOT / "data/auto_capture_items.json"
    if auto.exists():
        rows.extend(json.loads(auto.read_text()))
    cache = translate_rows(rows)
    print(f"{len(cache)} translations cached")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
