import { scoreEvent, type EventAnalysis } from "./scoring.ts";

type RawEvent = Record<string, unknown>;
const textOf = (value: unknown) => value == null ? "" : String(value);
const valuesOf = (value: unknown) => Array.isArray(value) ? value : [];

/** Compatibility prefilter: deterministic scoring is applied before capture persists an item. */
export function analyze(raw: RawEvent) { return scoreEvent(raw); }

export function applySemanticJudgment(row: RawEvent, judgment: RawEvent) {
  const strength = Math.max(0, Math.min(3, Number(judgment.strength || 0)));
  const evidenceText = textOf(row.summary || row.title).slice(0, 500);
  const analysis: EventAnalysis = {
    event_type: textOf(judgment.ghost_type), is_market_event: Number(judgment.strength || 0) >= 2,
    strength, confidence: strength >= 2 ? 0.75 : 0.5,
    features: {
      event_actuality: 0.8, novelty: 0.7, surprise: 0.6, magnitude: strength / 3,
      direct_exposure: 0.8, causal_strength: 0.7, breadth: 0.6, persistence: 0.6, uncertainty: 0.2,
    },
    evidence: evidenceText ? [{ field: row.summary ? "summary" : "title", quote: evidenceText, claim: textOf(judgment.reason || "semantic event evidence") }] : [], conflicts: [],
  };
  const next = scoreEvent(row, analysis);
  Object.assign(row, next, { rationale: [...valuesOf(next.rationale).map(textOf), `semantic_type=${analysis.event_type}`, `semantic_strength=${strength}`] });
  return row;
}

export function normalizeArticle(article: RawEvent) {
  const symbols = valuesOf(article.ticker_sentiment).map((item) => textOf(item && typeof item === "object" ? (item as Record<string, unknown>).ticker : "").split(":").pop()).filter(Boolean);
  return analyze({ title: article.title, summary: article.summary, source: article.source || "Alpha Vantage", published_at: article.time_published, url: article.url, symbols });
}
