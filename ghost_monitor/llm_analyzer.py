from __future__ import annotations

import hashlib
import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from .qveris_client import ssl_context

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "llm_analysis_cache.json"
SCHEMA_VERSION = "direction-prob-v2"

ALLOWED_TYPES = {
    "ordinary_ai_news",
    "compute_overcapacity",
    "capex_roi_doubt",
    "order_inventory_weakness",
    "hbm_shortage",
    "capacity_flood",
    "data_center_delay",
    "financing_stress",
    "export_regulatory",
    "capital_markets_memory",
}


def analyze_with_llm(item: dict[str, Any], allow_network: bool = True) -> dict[str, Any] | None:
    load_project_env()
    cache = load_cache()
    key_hash = cache_key(item)
    if key_hash in cache:
        return normalize(cache[key_hash])
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return None
    if not allow_network:
        return None
    result = call_llm(item)
    if not result:
        return None
    result = normalize(result)
    cache[key_hash] = result
    save_cache(cache)
    return result


def load_project_env() -> None:
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ[k.strip()] = v.strip().strip("'\"")


def load_cache() -> dict[str, Any]:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def save_cache(cache: dict[str, Any]) -> None:
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


def cache_key(item: dict[str, Any]) -> str:
    blob = json.dumps({
        "title": item.get("title", ""),
        "summary": item.get("summary", ""),
        "source": item.get("source", ""),
        "symbols": item.get("symbols", []),
        "model": os.environ.get("OPENAI_MODEL", "deepseek-chat"),
        "schema_version": SCHEMA_VERSION,
    }, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(blob.encode()).hexdigest()


def call_llm(item: dict[str, Any]) -> dict[str, Any] | None:
    base = os.environ.get("OPENAI_BASE_URL", "https://api.deepseek.com").rstrip("/")
    model = os.environ.get("OPENAI_MODEL", "deepseek-chat")
    prompt = f"""
你是美股 AI 算力交易叙事分析器。判断这条新闻是否是会影响 AI 算力/芯片/HBM/数据中心/云厂商 CapEx 定价的“鬼故事”。

只返回 JSON，不要解释。字段：
{{
  "is_ghost": true/false,
  "ghost_type": "ordinary_ai_news|compute_overcapacity|capex_roi_doubt|order_inventory_weakness|hbm_shortage|capacity_flood|data_center_delay|financing_stress|export_regulatory|capital_markets_memory",
  "credibility": 1-3,
  "novelty": 1-3,
  "theme_strength": 1-3,
  "affected_layers": ["accelerator","basket","compute_leasing","hyperscaler","power_cooling","server_infra","foundry_equipment_eda","memory_storage"],
  "ticker_directions": {{"NVDA":"bullish|bearish|mixed|watch"}},
  "ticker_reaction_probabilities": {{"NVDA":{{"p_up":0.0-1.0,"confidence":0.0-1.0}}}},
  "direction_reasons": {{"NVDA":"一句中文理由"}},
  "reasoning": "一句中文总判断"
}}

判断规则：
- 普通正面产品新闻不要硬判利空。
- 方向要看叙事含义，不看情绪词。比如“算力过剩”通常利空芯片/算力租赁，但可能对卖出算力的一方混合或利多。
- 如果没有明确冲击 AI CapEx、GPU、HBM、数据中心、云算力需求，就 is_ghost=false，ghost_type=ordinary_ai_news。
- ticker_directions 只输出新闻直接相关或产业链明确相关的标的，不要把整张 universe 都填满。
- ticker_reaction_probabilities 判断“反应交易日收盘相对前一交易日收盘上涨”的概率；confidence 表示你对该概率判断的信心。

新闻：
{json.dumps({k: v for k, v in item.items() if k != "full_text"}, ensure_ascii=False)}
"""
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You output strict JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
        "max_tokens": 1200,
    }).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {os.environ['OPENAI_API_KEY']}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20, context=ssl_context()) as resp:
        payload = json.loads(resp.read())
    content = payload["choices"][0]["message"]["content"].strip()
    if content.startswith("```"):
        content = content.split("```", 2)[1]
        if content.startswith("json"):
            content = content[4:]
    parsed = json.loads(content)
    return parsed if isinstance(parsed, dict) else None


def normalize(row: dict[str, Any]) -> dict[str, Any]:
    row["ghost_type"] = row.get("ghost_type") if row.get("ghost_type") in ALLOWED_TYPES else "ordinary_ai_news"
    row["is_ghost"] = bool(row.get("is_ghost")) and row["ghost_type"] != "ordinary_ai_news"
    for key in ["credibility", "novelty", "theme_strength"]:
        try:
            row[key] = max(1, min(3, int(row.get(key, 1))))
        except Exception:
            row[key] = 1
    row["affected_layers"] = [str(x) for x in row.get("affected_layers", [])]
    dirs = {}
    for ticker, direction in dict(row.get("ticker_directions") or {}).items():
        direction = str(direction)
        if direction in {"bullish", "bearish", "mixed", "watch"}:
            dirs[str(ticker).upper()] = direction
    row["ticker_directions"] = dirs
    probs = {}
    for ticker, payload in dict(row.get("ticker_reaction_probabilities") or {}).items():
        if not isinstance(payload, dict):
            continue
        try:
            probs[str(ticker).upper()] = {
                "p_up": max(0.0, min(1.0, float(payload.get("p_up")))),
                "confidence": max(0.0, min(1.0, float(payload.get("confidence", 0.5)))),
            }
        except Exception:
            pass
    row["ticker_reaction_probabilities"] = probs
    row["direction_reasons"] = {str(k).upper(): str(v) for k, v in dict(row.get("direction_reasons") or {}).items()}
    row["reasoning"] = str(row.get("reasoning") or "")
    return row
