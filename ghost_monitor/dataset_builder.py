from __future__ import annotations

import json
import sys
from datetime import date, timedelta
from pathlib import Path

from .backfill_history import collect, is_relevant, normalize_article
from .firecrawl_client import markdown_for
from .market_impact import impact_for
from .scorer import analyze

ROOT = Path(__file__).resolve().parents[1]


def enrich_article(item: dict) -> dict:
    text = markdown_for(item.get("url", "")) if item.get("url") else ""
    if text:
        item = {**item, "full_text": text, "full_text_source": "firecrawl", "summary": f"{item.get('summary','')}\n\n原文摘录:\n{text[:1200]}"}
    return item


def build(start: date, end: date, limit: int = 200) -> list[dict]:
    articles = collect(start, end)
    if not articles and (ROOT / "data/backfill_articles.json").exists():
        articles = json.loads((ROOT / "data/backfill_articles.json").read_text())
    rows = []
    for item in articles:
        if len(rows) >= limit:
            break
        if not is_relevant(item):
            continue
        rough = analyze(item).to_dict()
        if rough["ghost_type"] == "ordinary_ai_news" or rough["alert_level"] == "log":
            continue
        enriched = enrich_article(item)
        enriched["use_llm"] = True
        analysis = analyze(enriched).to_dict()
        if analysis["ghost_type"] == "ordinary_ai_news" or analysis["alert_level"] == "log":
            continue
        symbols = list(analysis["ticker_directions"])[:12] or analysis["symbols"][:12]
        impacts = [impact_for(symbol, event_date(enriched)) for symbol in symbols]
        rows.append({
            "event_id": stable_id(enriched),
            "date": event_date(enriched),
            "title": item.get("title", ""),
            "summary": item.get("summary", ""),
            "full_text_source": enriched.get("full_text_source", "qveris_summary"),
            "source": item.get("source", ""),
            "url": item.get("url", ""),
            "ghost_type": analysis["ghost_type"],
            "ghost_score": analysis["ghost_score"],
            "analysis_method": analysis["analysis_method"],
            "ticker_directions": analysis["ticker_directions"],
            "direction_reasons": analysis["direction_reasons"],
            "market_impact": impacts,
        })
    return rows


def event_date(item: dict) -> str:
    raw = str(item.get("published_at") or "")
    if len(raw) >= 8 and raw[:8].isdigit():
        return f"{raw[:4]}-{raw[4:6]}-{raw[6:8]}"
    return raw[:10] if raw else date.today().isoformat()


def stable_id(item: dict) -> str:
    import hashlib

    return hashlib.sha1((item.get("url") or item.get("title", "")).encode()).hexdigest()[:12]


def main(argv: list[str] | None = None) -> int:
    args = argv or sys.argv[1:]
    end = date.fromisoformat(args[1]) if len(args) > 1 else date.today()
    start = date.fromisoformat(args[0]) if args else end - timedelta(days=730)
    limit = int(args[2]) if len(args) > 2 else 200
    rows = build(start, end, limit)
    out = ROOT / "data/training_events.json"
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False))
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
