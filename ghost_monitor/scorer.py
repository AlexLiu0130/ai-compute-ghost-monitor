from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from typing import Any

from .rules import GHOST_TYPES, SOURCE_TIER
from .universe import ALIASES, LAYERS, SYMBOL_TO_LAYER


@dataclass
class NewsItem:
    title: str
    summary: str = ""
    source: str = "unknown"
    published_at: str = ""
    url: str = ""
    symbols: list[str] | None = None
    market: dict[str, Any] | None = None


@dataclass
class GhostAnalysis:
    title: str
    summary: str
    source: str
    ghost_type: str
    credibility: int
    novelty: int
    theme_strength: int
    contagion: int
    market_confirmation: int
    ghost_score: int
    alert_level: str
    symbols: list[str]
    affected_layers: list[str]
    ticker_directions: dict[str, str]
    rationale: list[str]
    url: str = ""
    published_at: str = ""
    analysis_method: str = "rules"
    direction_reasons: dict[str, str] = field(default_factory=dict)
    ml_predictions: dict[str, dict[str, Any]] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def analyze(raw: dict[str, Any]) -> GhostAnalysis:
    item = NewsItem(
        title=str(raw.get("title") or raw.get("headline") or ""),
        summary=str(raw.get("summary") or raw.get("description") or ""),
        source=str(raw.get("source") or "unknown"),
        published_at=str(raw.get("published_at") or raw.get("datetime") or raw.get("time_published") or ""),
        url=str(raw.get("url") or ""),
        symbols=list(raw.get("symbols") or raw.get("tickers") or []),
        market=dict(raw.get("market") or {}),
    )
    text = f"{item.title} {item.summary}".lower()
    symbols = normalize_symbols(item.symbols or [], text)
    use_llm = bool(raw.get("use_llm"))
    llm = llm_analysis(item, symbols, allow_network=raw.get("use_llm") is True) if use_llm else None
    ghost_type, keyword_hits = classify_type(text)
    if llm:
        ghost_type = str(llm.get("ghost_type") or ghost_type)
    affected_layers = layers_for(ghost_type, symbols)
    if llm and llm.get("affected_layers"):
        affected_layers = sorted(set(affected_layers) | {str(x) for x in llm["affected_layers"]})
    directions = directions_for(ghost_type, symbols, affected_layers)
    if llm and isinstance(llm.get("ticker_directions"), dict):
        llm_directions = {str(k).upper(): str(v) for k, v in llm["ticker_directions"].items() if str(v) in {"bullish", "bearish", "mixed", "watch"}}
        directions = llm_directions or directions
        symbols = sorted(set(symbols) | set(directions))

    credibility = score_credibility(item.source)
    novelty = score_novelty(text)
    theme_strength = score_theme_strength(text, keyword_hits)
    if llm:
        credibility = clamp_score(llm.get("credibility"), credibility)
        novelty = clamp_score(llm.get("novelty"), novelty)
        theme_strength = clamp_score(llm.get("theme_strength"), theme_strength)
    contagion = min(3, max(1, len(affected_layers)))
    market_confirmation = score_market_confirmation(item.market or {}, directions)
    ghost_score = normalize_ghost_score(credibility * novelty * theme_strength * contagion * market_confirmation)
    alert_level = level_for_score(ghost_score)
    if llm and llm.get("is_ghost") is False:
        alert_level = "log"

    rationale = [
        f"type={ghost_type}",
        f"source_credibility={credibility}",
        f"matched_keywords={', '.join(keyword_hits[:6]) or 'none'}",
        f"affected_layers={', '.join(affected_layers) or 'none'}",
    ]
    if llm and llm.get("reasoning"):
        rationale.insert(0, str(llm["reasoning"]))
    if market_confirmation == 1:
        rationale.append("market confirmation weak or missing")

    ml_predictions = {}
    try:
        from .ml_model import predict
        ml_predictions = predict(ghost_type, directions, llm, direct_symbols=set(symbols), ghost_score=ghost_score)
    except Exception:
        pass

    return GhostAnalysis(
        title=item.title,
        summary=item.summary,
        source=item.source,
        ghost_type=ghost_type,
        credibility=credibility,
        novelty=novelty,
        theme_strength=theme_strength,
        contagion=contagion,
        market_confirmation=market_confirmation,
        ghost_score=ghost_score,
        alert_level=alert_level,
        symbols=symbols,
        affected_layers=affected_layers,
        ticker_directions=directions,
        rationale=rationale,
        url=item.url,
        published_at=item.published_at,
        analysis_method="llm" if llm else "rules",
        direction_reasons=dict(llm.get("direction_reasons") or {}) if llm else {},
        ml_predictions=ml_predictions,
    )


def llm_analysis(item: NewsItem, symbols: list[str], allow_network: bool = True) -> dict[str, Any] | None:
    try:
        from .llm_analyzer import analyze_with_llm
        return analyze_with_llm({
            "title": item.title,
            "summary": item.summary,
            "source": item.source,
            "published_at": item.published_at,
            "url": item.url,
            "symbols": symbols,
        }, allow_network=allow_network)
    except Exception:
        return None


def clamp_score(value: Any, fallback: int) -> int:
    try:
        return max(1, min(3, int(value)))
    except Exception:
        return fallback


def normalize_ghost_score(value: Any) -> int:
    try:
        raw = float(value)
    except Exception:
        return 0
    if raw <= 1:
        return 0
    return max(0, min(100, round(((raw - 1) / 242) ** 0.45 * 100)))


def level_for_score(score: int) -> str:
    return "alert" if score >= 60 else "watch" if score >= 20 else "log"


def classify_type(text: str) -> tuple[str, list[str]]:
    best = ("ordinary_ai_news", [])
    for ghost_type, spec in GHOST_TYPES.items():
        hits = [kw for kw in spec["keywords"] if keyword_match(text, kw)]
        if len(hits) > len(best[1]):
            best = (ghost_type, hits)
    return best


def keyword_match(text: str, keyword: str) -> bool:
    if " " in keyword:
        return keyword in text
    return re.search(rf"\b{re.escape(keyword)}\b", text) is not None


def normalize_symbols(symbols: list[str], text: str) -> list[str]:
    found = {str(s).upper() for s in symbols}
    upper_text = text.upper()
    for alias, symbol in ALIASES.items():
        if alias in upper_text:
            found.add(symbol)
    for symbol in SYMBOL_TO_LAYER:
        if re.search(rf"\b{re.escape(symbol)}\b", upper_text):
            found.add(symbol)
    return sorted(found)


def layers_for(ghost_type: str, symbols: list[str]) -> list[str]:
    layers = {SYMBOL_TO_LAYER[s] for s in symbols if s in SYMBOL_TO_LAYER}
    if ghost_type in GHOST_TYPES:
        layers.update(GHOST_TYPES[ghost_type]["layers"])
    return sorted(layers)


def directions_for(ghost_type: str, symbols: list[str], affected_layers: list[str]) -> dict[str, str]:
    layer_direction = GHOST_TYPES.get(ghost_type, {}).get("layers", {})
    out = {}
    for layer in affected_layers:
        direction = layer_direction.get(layer, "watch")
        for symbol in LAYERS.get(layer, []):
            if not symbols or symbol in symbols or layer in layer_direction:
                out[symbol] = direction
    return out


def score_credibility(source: str) -> int:
    normalized = source.lower()
    return max([score for name, score in SOURCE_TIER.items() if name in normalized] or [1])


def score_novelty(text: str) -> int:
    high = ["reportedly", "plans to", "announced", "first", "new", "unexpected", "cuts", "sold out", "listing", "offering"]
    medium = ["concern", "could", "may", "watch", "analyst"]
    if any(word in text for word in high):
        return 3
    if any(word in text for word in medium):
        return 2
    return 1


def score_theme_strength(text: str, keyword_hits: list[str]) -> int:
    direct = ["compute", "capex", "gpu", "hbm", "data center", "blackwell", "memory", "ai infrastructure"]
    if keyword_hits or any(word in text for word in direct):
        return 3
    if "ai" in text or "semiconductor" in text or "chip" in text:
        return 2
    return 1


def score_market_confirmation(market: dict[str, Any], directions: dict[str, str]) -> int:
    if not market:
        return 1
    confirmed = 0
    for symbol, payload in market.items():
        if symbol not in directions or not isinstance(payload, dict):
            continue
        move = float(payload.get("return_pct") or 0)
        volume_z = float(payload.get("volume_z") or 0)
        direction = directions[symbol]
        aligned = (direction == "bullish" and move > 1) or (direction == "bearish" and move < -1) or direction == "mixed"
        if aligned and (abs(move) >= 1.5 or volume_z >= 2):
            confirmed += 1
    if confirmed >= 3:
        return 3
    if confirmed >= 1:
        return 2
    return 1
