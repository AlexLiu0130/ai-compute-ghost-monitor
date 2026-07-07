from __future__ import annotations

import json
import sys
from pathlib import Path

from .scorer import analyze


def main(argv: list[str] | None = None) -> int:
    paths = [Path(p) for p in (argv or sys.argv[1:])]
    if not paths:
        print("usage: python3 -m ghost_monitor.cli samples/*.json", file=sys.stderr)
        return 2
    results = []
    for path in paths:
        raw = json.loads(path.read_text())
        result = analyze(raw).to_dict()
        result["input_file"] = str(path)
        results.append(result)
    print(json.dumps(results, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
