from __future__ import annotations

import json
import hashlib
import sys
import time
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .market_impact import build_report
from .qveris_client import alpha_vantage_news, finnhub_company_news, load_env
from .scorer import analyze
from .universe import SYMBOL_TO_LAYER

ROOT = Path(__file__).resolve().parents[1]

GROUPS = {"technology": []}
FINNHUB_TICKERS = ["NVDA", "AMD", "AVGO", "MU", "SMCI", "ORCL", "META", "MSFT", "AMZN", "GOOGL"]


def av_time(day: date) -> str:
    return day.strftime("%Y%m%dT0000")


def unpack_payload(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload.get("result") or {}
    data = result.get("data")
    if isinstance(data, dict):
        return data
    if isinstance(result.get("truncated_content"), str):
        try:
            return json.loads(result["truncated_content"])
        except Exception:
            pass
    url = result.get("full_content_file_url")
    if url:
        try:
            with urllib.request.urlopen(url, timeout=8) as resp:
                return json.loads(resp.read())
        except Exception:
            pass
    return {}


def normalize_article(article: dict[str, Any]) -> dict[str, Any]:
    symbols = []
    for row in article.get("ticker_sentiment") or []:
        ticker = row.get("ticker")
        if ticker:
            symbols.append(str(ticker).split(":")[-1])
    return {
        "title": article.get("title") or "",
        "summary": article.get("summary") or "",
        "source": article.get("source") or article.get("source_domain") or "Alpha Vantage",
        "published_at": article.get("time_published") or "",
        "url": article.get("url") or "",
        "symbols": sorted(set(symbols)),
    }


def normalize_finnhub_article(article: dict[str, Any], symbol: str) -> dict[str, Any]:
    ts = int(article.get("datetime") or 0)
    return {
        "title": article.get("headline") or "",
        "summary": article.get("summary") or "",
        "source": article.get("source") or "Finnhub",
        "published_at": datetime.utcfromtimestamp(ts).strftime("%Y%m%dT%H%M%S") if ts else "",
        "url": article.get("url") or "",
        "symbols": sorted({article.get("related") or symbol}),
    }


def is_relevant(item: dict[str, Any]) -> bool:
    text = f"{item.get('title','')} {item.get('summary','')}".lower()
    title = str(item.get("title") or "").lower()
    noisy_title = [
        "shares in", "grows position", "raises holdings", "acquires new shares",
        "price target", "raises pt", "volatility & greeks", "earnings call transcript",
        "most undervalued", "dividend", "class action",
    ]
    if any(term in title for term in noisy_title):
        return False
    symbols = set(item.get("symbols") or [])
    universe_hit = bool(symbols & set(SYMBOL_TO_LAYER))
    company_terms = [
        "nvidia", "amd", "broadcom", "marvell", "tsmc", "asml", "micron", "samsung",
        "sk hynix", "hynix", "meta", "microsoft", "amazon", "google", "oracle",
        "coreweave", "nebius", "super micro", "vertiv",
    ]
    compute_terms = [
        "ai", "artificial intelligence", "gpu", "hbm", "memory", "semiconductor", "chip",
        "data center", "datacenter", "hyperscale", "hyperscaler", "compute", "nvidia",
        "amd", "broadcom", "tsmc", "micron", "samsung", "hynix", "coreweave", "nebius",
    ]
    ghost_terms = [
        "selloff", "rout", "slump", "tumble", "overcapacity", "oversupply", "excess",
        "capex", "spending", "lease", "cancel", "delay", "shortage", "sold out",
        "export", "restriction", "inventory", "order cut", "weak", "debt", "financing",
        "listing", "offering", "price war", "capacity",
    ]
    return (universe_hit or any(term in text for term in company_terms)) and any(term in text for term in compute_terms) and any(term in text for term in ghost_terms)


def collect(start: date, end: date, window_days: int = 7) -> list[dict[str, Any]]:
    load_env(ROOT / ".env")
    raw_dir = ROOT / "data/backfill_raw"
    raw_dir.mkdir(parents=True, exist_ok=True)
    articles: dict[str, dict[str, Any]] = {}
    cursor = start
    while cursor <= end:
        win_end = min(end, cursor + timedelta(days=window_days - 1))
        for group, tickers in GROUPS.items():
            path = raw_dir / f"av_{group}_{cursor.isoformat()}_{win_end.isoformat()}.json"
            if path.exists():
                payload = json.loads(path.read_text())
            else:
                try:
                    payload = alpha_vantage_news(tickers, limit=1000, time_from=av_time(cursor), time_to=av_time(win_end))
                except Exception as exc:
                    payload = {"error": str(exc), "result": {"data": {"feed": []}}}
                path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
                time.sleep(0.4)
            data = unpack_payload(payload)
            for article in data.get("feed") or []:
                normalized = normalize_article(article)
                if not is_relevant(normalized):
                    continue
                key = normalized["url"] or f"{normalized['published_at']}:{normalized['title']}"
                articles[key] = normalized
        cursor = win_end + timedelta(days=1)
    for symbol in FINNHUB_TICKERS:
        cursor = start
        while cursor <= end:
            win_end = min(end, cursor + timedelta(days=89))
            path = raw_dir / f"finnhub_{symbol}_{cursor.isoformat()}_{win_end.isoformat()}.json"
            if path.exists():
                payload = json.loads(path.read_text())
            else:
                try:
                    payload = finnhub_company_news(symbol, cursor.isoformat(), win_end.isoformat())
                except Exception as exc:
                    payload = {"error": str(exc), "result": {"data": []}}
                path.write_text(json.dumps(payload, indent=2, ensure_ascii=False))
                time.sleep(0.4)
            data = unpack_payload(payload)
            feed = data if isinstance(data, list) else data.get("feed", [])
            for article in feed:
                normalized = normalize_finnhub_article(article, symbol)
                if not is_relevant(normalized):
                    continue
                key = normalized["url"] or f"{normalized['published_at']}:{normalized['title']}"
                articles[key] = normalized
            cursor = win_end + timedelta(days=1)
    return list(articles.values())


def case_from_analysis(item: dict[str, Any], analysis: dict[str, Any]) -> dict[str, Any]:
    published = item.get("published_at") or ""
    day = datetime.strptime(published[:8], "%Y%m%d").date().isoformat() if len(published) >= 8 and published[:8].isdigit() else date.today().isoformat()
    stable_id = hashlib.sha1((item.get("url") or item.get("title") or "").encode()).hexdigest()[:10]
    return {
        "id": f"{day}-{stable_id}",
        "date": day,
        "published_at": item.get("published_at", ""),
        "title": item["title"],
        "ghost_type": analysis["ghost_type"],
        "source": item["source"],
        "first_source": item["source"],
        "narrative": item["summary"][:500],
        "expected_direction": analysis["ticker_directions"],
        "symbols": analysis["symbols"][:12],
        "evidence_urls": [item["url"]] if item.get("url") else [],
        "reported_impact": "Computed from Yahoo Finance daily prices where available.",
        "ghost_score": analysis["ghost_score"],
        "alert_level": analysis["alert_level"],
    }


def main(argv: list[str] | None = None) -> int:
    args = argv or sys.argv[1:]
    end = date.fromisoformat(args[1]) if len(args) > 1 else date.today()
    start = date.fromisoformat(args[0]) if args else end - timedelta(days=91)
    case_limit = int(args[2]) if len(args) > 2 else 300
    impact_limit = int(args[3]) if len(args) > 3 else 40
    articles = collect(start, end)
    analyzed = []
    for item in articles:
        row = analyze(item).to_dict()
        if row["alert_level"] in {"watch", "alert"} and row["ghost_type"] != "ordinary_ai_news":
            analyzed.append(case_from_analysis(item, row))
    analyzed.sort(key=lambda x: (x["date"], x["ghost_score"]), reverse=True)
    cases = analyzed[:case_limit]
    (ROOT / "data/backfill_articles.json").write_text(json.dumps(articles, indent=2, ensure_ascii=False))
    (ROOT / "data/backfill_cases.json").write_text(json.dumps(cases, indent=2, ensure_ascii=False))
    if impact_limit:
        report = build_report(cases[:impact_limit])
        out = ROOT / "reports/backfill_market_impact.json"
        out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(ROOT / "data/backfill_cases.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
