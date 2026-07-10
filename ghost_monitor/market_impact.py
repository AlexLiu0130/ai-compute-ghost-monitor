from __future__ import annotations

import json
import math
import sys
import time
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

from .qveris_client import ssl_context

ROOT = Path(__file__).resolve().parents[1]
PRICE_CACHE = ROOT / "data" / "price_window_cache.json"
_CACHE: dict[str, Any] | None = None


def _load_cache() -> dict[str, Any]:
    global _CACHE
    if _CACHE is None:
        _CACHE = json.loads(PRICE_CACHE.read_text()) if PRICE_CACHE.exists() else {}
    return _CACHE


def _save_cache(cache: dict[str, Any]) -> None:
    PRICE_CACHE.parent.mkdir(exist_ok=True)
    PRICE_CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


def yahoo_symbol(symbol: str) -> str:
    if symbol.endswith(".KS"):
        return symbol
    return symbol


def fetch_chart(symbol: str, start: date, end: date) -> list[dict[str, Any]]:
    key = f"{symbol}|{start.isoformat()}|{end.isoformat()}"
    cache = _load_cache()
    if key in cache and not stale_cache(cache[key], end):
        return cache[key]
    p1 = int(time.mktime(start.timetuple()))
    p2 = int(time.mktime((end + timedelta(days=1)).timetuple()))
    encoded = urllib.parse.quote(yahoo_symbol(symbol), safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?period1={p1}&period2={p2}&interval=1d&events=history"
    req = urllib.request.Request(url, headers={"user-agent": "ghost-monitor/0.1"})
    with urllib.request.urlopen(req, timeout=20, context=ssl_context()) as resp:
        payload = json.loads(resp.read())
    result = payload.get("chart", {}).get("result") or []
    if not result:
        return []
    rows = []
    timestamps = result[0].get("timestamp") or []
    quote = (result[0].get("indicators", {}).get("quote") or [{}])[0]
    adj = (result[0].get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or quote.get("close") or []
    for i, ts in enumerate(timestamps):
        close = adj[i] if i < len(adj) else None
        volume = (quote.get("volume") or [None])[i]
        if close is None or (isinstance(close, float) and math.isnan(close)):
            continue
        rows.append({"date": datetime.utcfromtimestamp(ts).date().isoformat(), "close": float(close), "volume": volume})
    cache[key] = rows
    _save_cache(cache)
    return rows


def latest_available_trading_day(now_utc: datetime | None = None) -> date:
    now_utc = now_utc or datetime.utcnow()
    day = now_utc.date()
    if not is_us_trading_day(day):
        return previous_trading_day(day)
    # US cash close is 20:00 UTC during daylight saving time. The extra hour
    # gives Yahoo's daily bar time to settle before we treat it as available.
    return day if now_utc.hour >= 21 else previous_trading_day(day - timedelta(days=1))


def stale_cache(rows: list[dict[str, Any]], end: date) -> bool:
    if not rows:
        return False
    required = previous_trading_day(min(end, latest_available_trading_day()))
    return rows[-1]["date"] < required.isoformat()


def first_on_or_after(rows: list[dict[str, Any]], event_date: str, offset: int = 0) -> dict[str, Any] | None:
    eligible = [r for r in rows if r["date"] >= event_date]
    if len(eligible) <= offset:
        return None
    return eligible[offset]


def last_before(rows: list[dict[str, Any]], event_date: str) -> dict[str, Any] | None:
    eligible = [r for r in rows if r["date"] < event_date]
    return eligible[-1] if eligible else None


def pct(a: float, b: float) -> float:
    return round((b / a - 1) * 100, 2)


def parse_event_at(value: str) -> datetime:
    raw = str(value or "").replace("Z", "+00:00")
    if len(raw) >= 8 and raw[:8].isdigit() and (len(raw) == 8 or raw[8] == "T"):
        tail = "".join(ch for ch in raw[9:] if ch.isdigit())[:6].ljust(6, "0")
        return datetime.strptime(raw[:8] + tail, "%Y%m%d%H%M%S")
    return datetime.fromisoformat(raw if "T" in raw else f"{raw}T00:00:00")


US_MARKET_HOLIDAYS = {
    # NYSE/Nasdaq full-day closures. Keep this small and explicit for the
    # current backfill window instead of pulling in a calendar dependency.
    "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27",
    "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
    "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18",
    "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27",
    "2025-12-25",
    "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25",
    "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
}


def is_us_trading_day(day: date) -> bool:
    return day.weekday() < 5 and day.isoformat() not in US_MARKET_HOLIDAYS


def next_trading_day(day: date) -> date:
    while not is_us_trading_day(day):
        day += timedelta(days=1)
    return day


def previous_trading_day(day: date) -> date:
    while not is_us_trading_day(day):
        day -= timedelta(days=1)
    return day


def expected_reaction_date(event_at: datetime) -> str:
    day = event_at.date()
    if not is_us_trading_day(day):
        return next_trading_day(day).isoformat()
    # Approximate exchange close in UTC. Daily bars confirm the exact result once available.
    if event_at.hour >= 20:
        return next_trading_day(day + timedelta(days=1)).isoformat()
    return day.isoformat()


def reaction_rows(rows: list[dict[str, Any]], event_at: datetime) -> tuple[dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None, dict[str, Any] | None]:
    day = event_at.date().isoformat()
    after_close = event_at.hour >= 20
    eligible = [r for r in rows if r["date"] > day] if after_close else [r for r in rows if r["date"] >= day]
    reaction = eligible[0] if eligible else None
    if not reaction:
        prev = last_before(rows, day)
        return prev, None, None, None
    prev = last_before(rows, reaction["date"])
    next_row = eligible[1] if len(eligible) > 1 else None
    third_row = eligible[3] if len(eligible) > 3 else None
    return prev, reaction, next_row, third_row


def impact_for(symbol: str, event_date: str) -> dict[str, Any]:
    event_at = parse_event_at(event_date)
    start = event_at.date() - timedelta(days=10)
    end = event_at.date() + timedelta(days=10)
    try:
        rows = fetch_chart(symbol, start, end)
        prev, d0, d1, d3 = reaction_rows(rows, event_at)
        if not prev:
            return {"symbol": symbol, "error": "missing price window"}
        if not d0:
            return {
                "symbol": symbol,
                "pending": "waiting_for_reaction_close",
                "expected_reaction_date": expected_reaction_date(event_at),
                "prev_date": prev["date"],
                "prev_close": round(prev["close"], 4),
            }
        return {
            "symbol": symbol,
            "prev_date": prev["date"],
            "reaction_trade_date": d0["date"],
            "prev_close": round(prev["close"], 4),
            "reaction_close": round(d0["close"], 4),
            "next_close": round(d1["close"], 4) if d1 else None,
            "reaction_pct": pct(prev["close"], d0["close"]),
            "next_day_pct": pct(d0["close"], d1["close"]) if d1 else None,
            "three_session_pct": pct(prev["close"], d3["close"]) if d3 else None,
        }
    except Exception as exc:
        return {"symbol": symbol, "error": str(exc)}


def build_report(cases: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for case in cases:
        impacts = [impact_for(symbol, case["date"]) for symbol in case["symbols"]]
        out.append({**case, "market_impact": impacts})
    return out


def main(argv: list[str] | None = None) -> int:
    src = Path(argv[0]) if argv else ROOT / "data/historical_cases.json"
    cases = json.loads(src.read_text())
    report = build_report(cases)
    out = ROOT / "reports/historical_cases_with_market_impact.json"
    out.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
