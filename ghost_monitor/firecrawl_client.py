from __future__ import annotations

import json
import os
import urllib.request
from pathlib import Path
from typing import Any

from .qveris_client import load_env

ROOT = Path(__file__).resolve().parents[1]
BASE_URL = "https://api.firecrawl.dev/v1"
CACHE_DIR = ROOT / "data/firecrawl_cache"
BAD_MARKERS = (
    "Checking your Browser",
    "Oops, something went wrong",
    "Verification failed",
    "Access denied",
    "Enable JavaScript",
    "Attention Required!",
)


def scrape(url: str) -> dict[str, Any] | None:
    cached = cache_path(url)
    if cached.exists():
        return json.loads(cached.read_text())
    load_env(ROOT / ".env")
    key = os.environ.get("FIRECRAWL_API_KEY")
    if not key:
        return None
    body = json.dumps({
        "url": url,
        "formats": ["markdown"],
        "onlyMainContent": True,
        "timeout": 10000,
    }).encode()
    req = urllib.request.Request(
        f"{os.environ.get('FIRECRAWL_BASE_URL', BASE_URL).rstrip('/')}/scrape",
        data=body,
        headers={"content-type": "application/json", "authorization": f"Bearer {key}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            payload = json.loads(resp.read())
    except Exception:
        return None
    data = payload.get("data") or payload
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    return data


def cache_path(url: str) -> Path:
    import hashlib

    return CACHE_DIR / f"{hashlib.sha1(url.encode()).hexdigest()}.json"


def markdown_for(url: str) -> str:
    data = scrape(url)
    if not data:
        return ""
    text = str(data.get("markdown") or data.get("content") or "")
    return "" if is_bad_markdown(text) else text[:12000]


def is_bad_markdown(text: str) -> bool:
    stripped = text.strip()
    return len(stripped) < 500 or any(marker.lower() in stripped.lower() for marker in BAD_MARKERS)
