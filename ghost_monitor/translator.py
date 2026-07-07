from __future__ import annotations

import hashlib
import json
import os
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Any

from .qveris_client import ssl_context

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "data" / "translation_cache.json"


def cache_key(title: str, summary: str) -> str:
    return hashlib.sha1(f"{title}\n{summary}".encode()).hexdigest()


def load_cache() -> dict[str, Any]:
    return json.loads(CACHE.read_text()) if CACHE.exists() else {}


def save_cache(cache: dict[str, Any]) -> None:
    CACHE.parent.mkdir(exist_ok=True)
    CACHE.write_text(json.dumps(cache, indent=2, ensure_ascii=False))


def load_env_override(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ[key.strip()] = value.strip().strip("'\"")


def apply_translation(row: dict[str, Any], cache: dict[str, Any] | None = None) -> dict[str, Any]:
    cache = cache if cache is not None else load_cache()
    hit = cache.get(cache_key(row.get("title", ""), row.get("summary", "")))
    if hit:
        row["title_zh"] = polish(hit.get("title_zh", ""))
        row["summary_zh"] = polish(hit.get("summary_zh", ""))
    return row


def polish(text: str) -> str:
    return (
        text.replace("，你需要知道什么？", "，发生了什么？")
        .replace("，您需要了解什么？", "，发生了什么？")
        .replace("你需要知道什么", "发生了什么")
        .replace("您需要了解什么", "发生了什么")
    )


def translate_rows(rows: list[dict[str, Any]], batch_size: int = 20, force: bool = False) -> dict[str, Any]:
    load_env_override(ROOT / ".env")
    cache = load_cache()
    missing = []
    for row in rows:
        key = cache_key(row.get("title", ""), row.get("summary", ""))
        if (force or key not in cache) and (row.get("title") or row.get("summary")):
            missing.append({"key": key, "title": row.get("title", ""), "summary": row.get("summary", "")})
    for i in range(0, len(missing), batch_size):
        translated = _translate_batch(missing[i:i + batch_size])
        for item in translated:
            key = item.get("key")
            if key:
                cache[key] = {
                    "title_zh": item.get("title_zh", ""),
                    "summary_zh": item.get("summary_zh", ""),
                }
        save_cache(cache)
    return cache


def _translate_batch(items: list[dict[str, str]]) -> list[dict[str, str]]:
    if not items:
        return []
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        return _translate_batch_google(items)
    base = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com").rstrip("/")
    model = os.environ.get("OPENAI_MODEL", "gpt-4.1-mini")
    prompt = (
        "把下面美股/半导体/AI基础设施新闻翻译成专业、自然、适合交易员快速阅读的中文。"
        "不要机翻腔；保留 ticker、公司英文名、数字、金额、百分比和专有名词；"
        "标题要短而准，摘要要说明事件、影响对象和市场含义。"
        "只返回 JSON 数组，每项包含 key,title_zh,summary_zh。\n"
        + json.dumps(items, ensure_ascii=False)
    )
    body = json.dumps({
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a precise financial news translator. Return valid JSON only."},
            {"role": "user", "content": prompt},
        ],
        "temperature": 0.1,
    }).encode()
    req = urllib.request.Request(
        f"{base}/chat/completions",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=60, context=ssl_context()) as resp:
            payload = json.loads(resp.read())
        content = payload["choices"][0]["message"]["content"].strip()
        if content.startswith("```"):
            content = content.split("```", 2)[1]
            if content.startswith("json"):
                content = content[4:]
        parsed = json.loads(content)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return _translate_batch_google(items)


def _translate_batch_google(items: list[dict[str, str]]) -> list[dict[str, str]]:
    return [
        {
            "key": item["key"],
            "title_zh": _google_translate(item.get("title", "")),
            "summary_zh": _google_translate(item.get("summary", "")),
        }
        for item in items
    ]


def _google_translate(text: str) -> str:
    if not text:
        return ""
    query = urllib.parse.urlencode({
        "client": "gtx",
        "sl": "en",
        "tl": "zh-CN",
        "dt": "t",
        "q": text[:4500],
    })
    url = f"https://translate.googleapis.com/translate_a/single?{query}"
    req = urllib.request.Request(url, headers={"user-agent": "ghost-monitor/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=20, context=ssl_context()) as resp:
            payload = json.loads(resp.read())
        return "".join(part[0] for part in payload[0] if part and part[0])
    except Exception:
        return ""
