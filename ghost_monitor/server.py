from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from .market_impact import impact_for, latest_available_trading_day
from .qveris_client import alpha_vantage_news, load_env, ssl_context
from .scorer import analyze, level_for_score, normalize_ghost_score
from .translator import apply_translation, load_cache, translate_rows
from .universe import LAYERS

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
SAMPLES = ROOT / "samples"
DATA = ROOT / "data"
AUTO_CAPTURE = DATA / "auto_capture_items.json"
AUTO_SEEN = DATA / "auto_capture_seen.json"
QUOTE_CACHE: dict[str, tuple[float, dict]] = {}
QUOTE_TTL = 300
ALERTS_CACHE: dict = {"ts": 0.0, "rows": None}
ALERTS_TTL = 45
CORE_SYMBOLS = ["NVDA", "AMD", "AVGO", "MU", "SMCI", "META", "MSFT", "GOOGL"]
COMPUTE_TERMS = (
    "ai", "artificial intelligence", "gpu", "semiconductor", "chip", "hbm",
    "memory", "data center", "datacenter", "server", "compute", "nvidia",
    "amd", "broadcom", "micron", "sk hynix", "samsung", "tsmc",
)
UNIVERSE_SYMBOLS = {s for xs in LAYERS.values() for s in xs}
DISPLAY_LOOKBACK_DAYS = 366
POST_HOC_MARKET_MOVE_PATTERNS = [
    re.compile(pattern, re.I)
    for pattern in [
        r"\bwhy\b.{0,80}\b(stock|shares)\b",
        r"\bwhat\s+happened\b",
        r"\b(stock|shares)\b.{0,80}\b(fell|dropped|plunged|slumped|tumbled|declined|lost|rose|jumped|surged|soared)\b",
        r"\b(fell|dropped|plunged|slumped|tumbled|declined|lost|rose|jumped|surged|soared)\s+\d+(\.\d+)?%",
        r"\b(on|after)\s+the\s+news\b",
        r"为什么.{0,24}(下跌|上涨|暴跌|大涨)",
        r"(暴跌|大涨|下跌|上涨).{0,24}(原因|发生了什么)",
        r"股价.{0,24}(下跌|上涨|暴跌|大涨)",
    ]
]


def _case_key(row: dict) -> str:
    return f"{row.get('date') or row.get('published_at','')[:10]}|{row.get('title','')}"


def _impact_index() -> dict[str, list[dict]]:
    out = {}
    for path in [ROOT / "reports/backfill_market_impact.json", ROOT / "reports/backfill_3m_market_impact.json"]:
        if not path.exists():
            continue
        for row in json.loads(path.read_text()):
            out[row.get("id") or _case_key(row)] = row.get("market_impact") or []
            out[_case_key(row)] = row.get("market_impact") or []
    return out


def _iso_date(value: str) -> str:
    if not value:
        return ""
    if len(value) >= 8 and value[:8].isdigit() and (len(value) == 8 or value[8] == "T"):
        tail = "".join(ch for ch in value[9:] if ch.isdigit())[:6].ljust(6, "0")
        dt = datetime.strptime(value[:8] + tail, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
        return dt.isoformat().replace("+00:00", "Z")
    if "T" in value:
        return value
    return f"{value}T00:00:00Z"


def _sort_time(value: str) -> float:
    raw = str(value or "").replace("Z", "+00:00")
    try:
        if len(raw) >= 8 and raw[:8].isdigit() and (len(raw) == 8 or raw[8] == "T"):
            tail = "".join(ch for ch in raw[9:] if ch.isdigit())[:6].ljust(6, "0")
            return datetime.strptime(raw[:8] + tail, "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).timestamp()
        return datetime.fromisoformat(raw if "T" in raw else f"{raw}T00:00:00").timestamp()
    except Exception:
        return 0


def _is_within_display_window(row: dict, now: datetime | None = None, lookback_days: int = DISPLAY_LOOKBACK_DAYS) -> bool:
    ts = _sort_time(row.get("published_at", ""))
    if not ts:
        return False
    current = now or datetime.now(timezone.utc)
    age_days = (current.timestamp() - ts) / 86400
    return -1 <= age_days <= lookback_days


def _is_post_hoc_market_recap(row: dict) -> bool:
    text = f"{row.get('title', '')} {row.get('summary', '')} {row.get('title_zh', '')} {row.get('summary_zh', '')}"
    return any(pattern.search(text) for pattern in POST_HOC_MARKET_MOVE_PATTERNS)


def _is_displayable_signal(row: dict, now: datetime | None = None) -> bool:
    return _is_within_display_window(row, now=now) and not _is_post_hoc_market_recap(row)


def _quote(symbol: str) -> dict:
    now = time.time()
    cached = QUOTE_CACHE.get(symbol)
    if cached and now - cached[0] < QUOTE_TTL:
        return cached[1]
    encoded = urllib.parse.quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}?range=1d&interval=1m"
    try:
        req = urllib.request.Request(url, headers={"user-agent": "ghost-monitor/0.1"})
        with urllib.request.urlopen(req, timeout=8, context=ssl_context()) as resp:
            payload = json.loads(resp.read())
        result = (payload.get("chart", {}).get("result") or [])[0]
        meta = result.get("meta", {})
        price = meta.get("regularMarketPrice") or meta.get("previousClose")
        previous = meta.get("previousClose")
        data = {
            "price": round(float(price), 4) if price is not None else None,
            "previous_close": round(float(previous), 4) if previous is not None else None,
            "currency": meta.get("currency"),
            "exchange": meta.get("exchangeName"),
        }
        if data["price"] is not None and data["previous_close"]:
            data["change_pct"] = round((data["price"] / data["previous_close"] - 1) * 100, 2)
    except Exception as exc:
        data = {"error": str(exc)}
    QUOTE_CACHE[symbol] = (now, data)
    return data


def _quotes(symbols: list[str]) -> dict[str, dict]:
    symbols = [s for s in dict.fromkeys(symbols) if s]
    now = time.time()
    out = {s: QUOTE_CACHE[s][1] for s in symbols if s in QUOTE_CACHE and now - QUOTE_CACHE[s][0] < QUOTE_TTL}
    missing = [s for s in symbols if s not in out]
    if missing:
        try:
            encoded = urllib.parse.quote(",".join(missing), safe=",")
            url = f"https://query1.finance.yahoo.com/v7/finance/quote?symbols={encoded}"
            req = urllib.request.Request(url, headers={"user-agent": "ghost-monitor/0.1"})
            with urllib.request.urlopen(req, timeout=8, context=ssl_context()) as resp:
                payload = json.loads(resp.read())
            for item in payload.get("quoteResponse", {}).get("result", []):
                symbol = item.get("symbol")
                price = item.get("regularMarketPrice")
                previous = item.get("regularMarketPreviousClose")
                data = {
                    "price": round(float(price), 4) if price is not None else None,
                    "previous_close": round(float(previous), 4) if previous is not None else None,
                    "currency": item.get("currency"),
                    "exchange": item.get("fullExchangeName") or item.get("exchange"),
                }
                if data["price"] is not None and data["previous_close"]:
                    data["change_pct"] = round((data["price"] / data["previous_close"] - 1) * 100, 2)
                out[symbol] = data
                QUOTE_CACHE[symbol] = (now, data)
        except Exception:
            pass
    for symbol in missing:
        out.setdefault(symbol, _quote(symbol))
    return out


def _enrich(row: dict, translations: dict | None = None) -> dict:
    apply_translation(row, translations)
    return row


def _missing_impact(row: dict) -> bool:
    impacts = row.get("market_impact") or []
    if not impacts:
        return True
    available = latest_available_trading_day().isoformat()
    if any(x.get("pending") and x.get("expected_reaction_date", "9999-99-99") <= available for x in impacts):
        return True
    return not any(x.get("reaction_pct") is not None or x.get("event_day_pct") is not None or x.get("next_day_pct") is not None for x in impacts)


def _attach_impacts(rows: list[dict], max_rows: int = 24) -> int:
    refreshed = 0
    for row in rows:
        if refreshed >= max_rows:
            break
        if not _missing_impact(row):
            continue
        event_date = row.get("published_at") or ""
        if not event_date:
            continue
        symbols = list((row.get("ticker_directions") or {}).keys())[:8]
        if symbols:
            row["market_impact"] = [impact_for(symbol, event_date) for symbol in symbols]
            refreshed += 1
    return refreshed


def _load_alerts() -> list[dict]:
    rows = []
    for path in sorted(SAMPLES.glob("*.json")):
        raw = json.loads(path.read_text())
        raw["use_llm"] = "cached"
        rows.append(analyze(raw).to_dict())

    backfill = DATA / "backfill_cases.json"
    if backfill.exists():
        impacts = _impact_index()
        for case in json.loads(backfill.read_text()):
            row = analyze({
                "title": case.get("title", ""),
                "summary": case.get("narrative", ""),
                "source": case.get("source", "unknown"),
                "published_at": _iso_date(case.get("published_at") or case.get("date", "")),
                "url": (case.get("evidence_urls") or [""])[0],
                "symbols": case.get("symbols", []),
                "use_llm": False,
            }).to_dict()
            row["ghost_type"] = case.get("ghost_type", row["ghost_type"])
            row["ghost_score"] = normalize_ghost_score(case.get("ghost_score", row["ghost_score"]))
            row["alert_level"] = level_for_score(row["ghost_score"])
            row["ticker_directions"] = case.get("expected_direction") or row["ticker_directions"]
            try:
                from .ml_model import predict
                row["ml_predictions"] = predict(
                    row["ghost_type"],
                    row["ticker_directions"],
                    direct_symbols=set(case.get("symbols") or []),
                    ghost_score=row.get("ghost_score"),
                )
            except Exception:
                pass
            row["market_impact"] = case.get("market_impact") or impacts.get(case.get("id")) or impacts.get(_case_key(case)) or []
            rows.append(row)

    if AUTO_CAPTURE.exists():
        for item in json.loads(AUTO_CAPTURE.read_text()):
            row = analyze({
                "title": item.get("title", ""),
                "summary": item.get("summary", ""),
                "source": item.get("source", "unknown"),
                "published_at": item.get("published_at", ""),
                "url": item.get("url", ""),
                "symbols": item.get("symbols", []),
                "use_llm": "cached",
            }).to_dict()
            row["market_impact"] = item.get("market_impact") or []
            if row["ghost_type"] != "ordinary_ai_news" and row["alert_level"] != "log":
                rows.append(row)

    rows = [row for row in rows if _is_displayable_signal(row)]
    rows.sort(key=lambda row: _sort_time(row.get("published_at", "")), reverse=True)
    _attach_impacts(rows)
    try:
        translations = translate_rows(rows[:80])
    except Exception:
        translations = load_cache()
    rows = [_enrich(row, translations) for row in rows]
    price_symbols = []
    for row in rows[:15]:
        price_symbols.extend(list((row.get("ticker_directions") or {}).keys())[:6])
    prices = _quotes(price_symbols)
    for row in rows[:15]:
        symbols = list((row.get("ticker_directions") or {}).keys())[:6]
        row["current_prices"] = {symbol: prices.get(symbol, {}) for symbol in symbols}
    return rows


def _normalize_av_article(article: dict) -> dict:
    symbols = []
    for item in article.get("ticker_sentiment") or []:
        ticker = item.get("ticker")
        if ticker:
            symbols.append(str(ticker).split(":")[-1])
    published = article.get("time_published") or ""
    if len(published) >= 8 and published[:8].isdigit():
        published = f"{published[:4]}-{published[4:6]}-{published[6:8]}T{published[9:11] or '00'}:{published[11:13] or '00'}:00Z"
    return {
        "title": article.get("title") or "",
        "summary": article.get("summary") or "",
        "source": article.get("source") or "Alpha Vantage",
        "published_at": published,
        "url": article.get("url") or "",
        "symbols": sorted(set(symbols)),
    }


def _qveris_content(payload: dict) -> dict:
    result = payload.get("result") or {}
    content = result.get("data") or result.get("content")
    if isinstance(content, dict):
        return content
    if result.get("full_content_file_url"):
        with urllib.request.urlopen(result["full_content_file_url"], timeout=20, context=ssl_context()) as resp:
            return json.loads(resp.read())
    return {}


def _capture_queries(mode: str = "full") -> list[list[str]]:
    if mode == "global":
        return [[]]
    if mode == "core":
        return [CORE_SYMBOLS]
    symbols = [s for s in UNIVERSE_SYMBOLS if "." not in s]
    chunks = [symbols[i:i + 8] for i in range(0, len(symbols), 8)]
    return [[]] + chunks


def _compute_relevant(item: dict) -> bool:
    text = f"{item.get('title', '')} {item.get('summary', '')}".lower()
    symbols = {str(s).upper() for s in item.get("symbols") or []}
    symbols.update(str(x.get("ticker", "")).split(":")[-1].upper() for x in item.get("ticker_sentiment") or [])
    return bool(symbols & UNIVERSE_SYMBOLS) or any(term in text for term in COMPUTE_TERMS)


def capture_latest(mode: str = "full") -> dict:
    load_env(ROOT / ".env")
    DATA.mkdir(exist_ok=True)
    old = [r for r in (json.loads(AUTO_CAPTURE.read_text()) if AUTO_CAPTURE.exists() else []) if _compute_relevant(r)]
    stored_seen = {r.get("url") or r.get("title") for r in old}
    seen = set(json.loads(AUTO_SEEN.read_text())) if AUTO_SEEN.exists() else set()
    articles: dict[str, dict] = {}
    errors = []
    for tickers in _capture_queries(mode):
        try:
            content = _qveris_content(alpha_vantage_news(tickers, limit=50))
            for article in content.get("feed") or []:
                key = article.get("url") or article.get("title")
                if key and key not in seen and key not in stored_seen and _compute_relevant(article):
                    articles.setdefault(key, article)
                if key:
                    seen.add(key)
        except Exception as exc:
            errors.append(str(exc))
    rows = []
    for article in articles.values():
        if (article.get("url") or article.get("title")) in stored_seen:
            continue
        raw_item = _normalize_av_article(article)
        raw_item["use_llm"] = True
        row = analyze(raw_item).to_dict()
        if row["ghost_type"] != "ordinary_ai_news" and row["alert_level"] != "log":
            rows.append(row)
    try:
        cache = translate_rows(rows)
        for row in rows:
            apply_translation(row, cache)
    except Exception:
        pass
    merged = old + [r for r in rows if (r.get("url") or r.get("title")) not in stored_seen]
    stored = merged[-200:]
    _attach_impacts(sorted(stored, key=lambda row: _sort_time(row.get("published_at", "")), reverse=True), max_rows=12)
    AUTO_CAPTURE.write_text(json.dumps(stored, indent=2, ensure_ascii=False))
    AUTO_SEEN.write_text(json.dumps(sorted(seen)[-5000:], indent=2, ensure_ascii=False))
    status = {
        "fetched": len(articles),
        "captured": len(rows),
        "stored": len(stored),
        "mode": mode,
        "errors": errors[:3],
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (DATA / "auto_capture_status.json").write_text(json.dumps(status, indent=2, ensure_ascii=False))
    return status


def _next_capture_mode(now: datetime, status: dict) -> str:
    if now.hour == 21 and status.get("last_eod_date") != now.date().isoformat():
        return "full_eod"
    slot = int(now.timestamp() // 60)
    if slot % 12 == 0:
        return "full"
    if slot % 3 == 0:
        return "core"
    return "global"


def _capture_loop() -> None:
    minutes = int(os.environ.get("GHOST_CAPTURE_MINUTES", "5"))
    while True:
        try:
            status_path = DATA / "auto_capture_status.json"
            status = json.loads(status_path.read_text()) if status_path.exists() else {}
            now = datetime.utcnow()
            mode = _next_capture_mode(now, status)
            new_status = capture_latest("full" if mode == "full_eod" else mode)
            if mode == "full_eod":
                new_status["mode"] = mode
                new_status["last_eod_date"] = now.date().isoformat()
                status_path.write_text(json.dumps(new_status, indent=2, ensure_ascii=False))
        except Exception as exc:
            DATA.mkdir(exist_ok=True)
            (DATA / "auto_capture_status.json").write_text(json.dumps({"error": str(exc), "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=2))
        time.sleep(max(5, minutes) * 60)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB), **kwargs)

    def do_GET(self):
        path = urlparse(self.path).path
        if path.rstrip("/") == "/monitor":
            self.path = "/monitor.html"
            return super().do_GET()
        if path.rstrip("/") == "/developer":
            self.path = "/developer.html"
            return super().do_GET()
        if path == "/api/alerts":
            now = time.time()
            if ALERTS_CACHE["rows"] is None or now - ALERTS_CACHE["ts"] >= ALERTS_TTL:
                ALERTS_CACHE.update(ts=now, rows=_load_alerts())
            self._json(ALERTS_CACHE["rows"])
            return
        if path == "/api/capture/status":
            status = DATA / "auto_capture_status.json"
            self._json(json.loads(status.read_text()) if status.exists() else {"status": "pending"})
            return
        return super().do_GET()

    def do_POST(self):
        if self.headers.get("x-ghost-action") != "1":
            self._json({"error": "missing local action header"}, status=403)
            return
        if urlparse(self.path).path == "/api/capture":
            try:
                status = capture_latest("global")
                ALERTS_CACHE["rows"] = None
                self._json(status)
            except Exception as exc:
                self._json({"error": str(exc)}, status=500)
            return
        if urlparse(self.path).path != "/api/analyze":
            self.send_error(404)
            return
        raw = self.rfile.read(int(self.headers.get("content-length", "0")))
        try:
            payload = json.loads(raw)
            payload["use_llm"] = True
            self._json(analyze(payload).to_dict())
        except Exception as exc:
            self._json({"error": str(exc)}, status=400)

    def _json(self, payload, status: int = 200):
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    threading.Thread(target=_capture_loop, daemon=True).start()
    server = ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("http://127.0.0.1:8765")
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
