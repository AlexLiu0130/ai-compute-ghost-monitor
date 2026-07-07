from __future__ import annotations

import json
import sys
from pathlib import Path

from .qveris_client import alpha_vantage_news, load_env

ROOT = Path(__file__).resolve().parents[1]


def main(argv: list[str] | None = None) -> int:
    args = argv or sys.argv[1:]
    tickers = args or ["NVDA", "AMD", "TSM", "MU", "META", "MSFT", "GOOGL", "AMZN"]
    load_env(ROOT / ".env")
    payload = alpha_vantage_news(tickers)
    out = ROOT / "data"
    out.mkdir(exist_ok=True)
    path = out / "qveris_av_news_latest.json"
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
