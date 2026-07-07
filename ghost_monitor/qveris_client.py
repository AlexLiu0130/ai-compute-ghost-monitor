from __future__ import annotations

import json
import os
import ssl
import urllib.request
from pathlib import Path
from typing import Any

BASE_URL = "https://qveris.ai/api/v1"
AV_NEWS_TOOL = "alphavantage.news_sentiment.query.v1.467a92c0"
FINNHUB_COMPANY_NEWS_TOOL = "finnhub.companynews.retrieve.v1.e428b704"


def ssl_context() -> ssl.SSLContext | None:
    cafile = Path("/etc/ssl/cert.pem")
    return ssl.create_default_context(cafile=str(cafile)) if cafile.exists() else None


def load_env(path: str | Path) -> None:
    path = Path(path)
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def call_tool(tool_id: str, parameters: dict[str, Any]) -> dict[str, Any]:
    key = os.environ.get("QVERIS_API_KEY")
    if not key:
        raise RuntimeError("QVERIS_API_KEY not set")
    base = os.environ.get("QVERIS_BASE_URL", BASE_URL).rstrip("/")
    body = json.dumps({"tool_id": tool_id, "parameters": parameters}).encode()
    req = urllib.request.Request(
        f"{base}/tools/execute",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30, context=ssl_context()) as resp:
        return json.loads(resp.read())


def alpha_vantage_news(
    tickers: list[str],
    *,
    limit: int = 50,
    time_from: str | None = None,
    time_to: str | None = None,
) -> dict[str, Any]:
    params = {
        "function": "NEWS_SENTIMENT",
        "topics": "technology",
        "sort": "LATEST",
        "limit": str(limit),
    }
    if tickers:
        params["tickers"] = ",".join(tickers)
    if time_from:
        params["time_from"] = time_from
    if time_to:
        params["time_to"] = time_to
    return call_tool(
        AV_NEWS_TOOL,
        params,
    )


def finnhub_company_news(symbol: str, start: str, end: str) -> dict[str, Any]:
    return call_tool(FINNHUB_COMPANY_NEWS_TOOL, {"symbol": symbol, "from": start, "to": end})
