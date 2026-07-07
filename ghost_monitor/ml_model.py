from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .universe import SYMBOL_TO_LAYER

ROOT = Path(__file__).resolve().parents[1]
MODEL = ROOT / "data" / "ml_direction_model.json"


def train_from_reports() -> dict[str, Any]:
    counts: dict[str, dict[str, int]] = {}
    seen = set()
    raw_rows = 0
    used_rows = 0
    for path in [
        ROOT / "reports/backfill_market_impact.json",
        ROOT / "reports/backfill_3m_market_impact.json",
        ROOT / "reports/historical_cases_with_market_impact.json",
    ]:
        if not path.exists():
            continue
        for case in json.loads(path.read_text()):
            ghost_type = case.get("ghost_type", "unknown")
            expected = case.get("expected_direction") or {}
            direct_symbols = set(case.get("symbols") or [])
            score_bucket = score_bucket_for(case.get("ghost_score"))
            for row in case.get("market_impact") or []:
                raw_rows += 1
                move_value = row.get("reaction_pct", row.get("event_day_pct"))
                if move_value is None:
                    continue
                dedupe_key = (
                    case.get("id") or f"{case.get('date')}|{case.get('title')}",
                    row.get("symbol"),
                    row.get("reaction_trade_date") or row.get("event_trade_date") or case.get("date"),
                )
                if dedupe_key in seen:
                    continue
                seen.add(dedupe_key)
                used_rows += 1
                direction = expected.get(row.get("symbol"), "watch")
                move = float(move_value)
                for key in feature_keys(ghost_type, row.get("symbol", ""), direction, row.get("symbol") in direct_symbols, score_bucket):
                    bucket = counts.setdefault(key, {"up": 0, "down": 0, "n": 0, "sum_pct": 0.0})
                    bucket["n"] += 1
                    bucket["sum_pct"] = round(float(bucket.get("sum_pct", 0)) + move, 4)
                    if move > 0:
                        bucket["up"] += 1
                    else:
                        bucket["down"] += 1
    model = {
        "version": 2,
        "counts": counts,
        "training_summary": {"raw_rows": raw_rows, "used_rows": used_rows, "duplicates": raw_rows - used_rows},
        "note": "Experimental ensemble: global + ticker/layer/type/direction historical reaction signs. Not investment advice.",
    }
    MODEL.parent.mkdir(exist_ok=True)
    MODEL.write_text(json.dumps(model, indent=2, ensure_ascii=False))
    return model


def score_bucket_for(score: Any) -> str:
    try:
        n = int(score)
    except Exception:
        return "unknown"
    return "alert" if n >= 81 else "watch" if n >= 25 else "log"


def feature_keys(ghost_type: str, ticker: str, direction: str, direct: bool = False, score_bucket: str = "") -> list[str]:
    layer = SYMBOL_TO_LAYER.get(ticker, "unknown")
    keys = [
        "global",
        f"direction|{direction}",
        f"type|{ghost_type}",
        f"score_direction|{score_bucket}|{direction}" if score_bucket else "",
        f"type_direction|{ghost_type}|{direction}",
        f"layer_direction|{layer}|{direction}",
        f"ticker_direction|{ticker}|{direction}",
    ]
    if direct:
        keys.extend([
            f"direct_direction|{direction}",
            f"type_direct_direction|{ghost_type}|{direction}",
        ])
    return [k for k in keys if k]


def key_weight(key: str) -> float:
    if key.startswith("ticker_direction|"):
        return 4.0
    if key.startswith("type_direct_direction|"):
        return 3.0
    if key.startswith("direct_direction|"):
        return 2.5
    if key.startswith("layer_direction|"):
        return 2.2
    if key.startswith("type_direction|"):
        return 1.8
    if key.startswith("score_direction|"):
        return 1.2
    if key.startswith("type|"):
        return 0.9
    if key.startswith("direction|"):
        return 0.8
    return 0.35


def bucket_stats(bucket: dict[str, Any]) -> tuple[float, float, int]:
    n = int(bucket.get("n", 0))
    up = int(bucket.get("up", 0))
    p_up = (up + 1) / (n + 2)
    avg = float(bucket.get("sum_pct", 0)) / n if n else 0.0
    return p_up, avg, n


def blend_stats(model: dict[str, Any], keys: list[str]) -> tuple[float, float, int, list[str]]:
    weighted_p = weighted_move = total_w = 0.0
    max_n = 0
    basis = []
    for key in keys:
        bucket = model.get("counts", {}).get(key)
        if not bucket:
            continue
        p_up, avg, n = bucket_stats(bucket)
        weight = key_weight(key) * (min(n, 50) ** 0.5)
        weighted_p += p_up * weight
        weighted_move += avg * weight
        total_w += weight
        max_n = max(max_n, n)
        basis.append(f"{key}:n={n}")
    if not total_w:
        return 0.5, 0.0, 0, []
    return weighted_p / total_w, weighted_move / total_w, max_n, basis


def llm_adjustment(ticker: str, llm: dict[str, Any] | None) -> tuple[float, str]:
    if not llm:
        return 0.0, ""
    payload = dict(llm.get("ticker_reaction_probabilities") or {}).get(ticker)
    if not isinstance(payload, dict):
        return 0.0, ""
    try:
        p_up = float(payload.get("p_up"))
        confidence = max(0.0, min(1.0, float(payload.get("confidence", 0.5))))
    except Exception:
        return 0.0, ""
    return (p_up - 0.5) * min(0.35, confidence * 0.25), "llm"


def load_model() -> dict[str, Any]:
    return json.loads(MODEL.read_text()) if MODEL.exists() else train_from_reports()


def predict(
    ghost_type: str,
    ticker_directions: dict[str, str],
    llm: dict[str, Any] | None = None,
    *,
    direct_symbols: set[str] | None = None,
    ghost_score: int | None = None,
) -> dict[str, dict[str, Any]]:
    model = load_model()
    out = {}
    direct_symbols = direct_symbols or set()
    score_bucket = score_bucket_for(ghost_score)
    for ticker, direction in ticker_directions.items():
        is_direct = ticker in direct_symbols or bool(llm and ticker in dict(llm.get("ticker_directions") or {}))
        p_up, avg, n, basis = blend_stats(model, feature_keys(ghost_type, ticker, direction, is_direct, score_bucket))
        if not n:
            p_up = {"bullish": 0.58, "bearish": 0.42, "mixed": 0.5}.get(direction, 0.5)
        adj, adj_basis = llm_adjustment(ticker, llm)
        p_up = max(0.03, min(0.97, p_up + adj))
        confidence = round(abs(p_up - 0.5) * 2 * min(1.0, (n / 80) ** 0.5 if n else 0.35), 3)
        out[ticker] = {
            "p_up": round(p_up, 3),
            "p_down": round(1 - p_up, 3),
            "expected_reaction_pct": round(avg, 2) if n else None,
            "confidence": confidence,
            "basis": ", ".join(basis[:4] + ([adj_basis] if adj_basis else [])) or "fallback prior",
            "sample_size": n,
        }
    return out
