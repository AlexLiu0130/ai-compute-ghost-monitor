import { AGENT_PROMPT_VERSION, GHOST_TYPES, analysisMessages, critiqueMessages } from "./agent-prompts.ts";
import { isTrackedTicker, type EventAnalysis, type EventCritique, type TickerImpact } from "./scoring.ts";

type Row = Record<string, unknown>;
type ScoreEvent = (baseRow: Row, analysis?: EventAnalysis, critique?: EventCritique) => Row;
type ShouldCritique = (result: Row) => boolean;

const MODEL = "deepseek-chat";
const TOOL_BUDGET = { maxCalls: 0, usedCalls: 0, allowed: [] as string[] };
type Trace = { prompt: string; version: string; model: string; durationMs: number; status: "ok" | "skipped" | "failed"; error?: string; toolBudget: typeof TOOL_BUDGET };

function errorText(error: unknown) { return error instanceof Error ? error.message.slice(0, 180) : "agent_failed"; }
function object(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function addTrace(row: Row, name: "analysis" | "critique", trace: Trace) { row.agent_trace = { ...(object(row.agent_trace) || {}), [name]: trace }; }
function fallback(row: Row, prompt: "analysis" | "critique", status: Trace["status"], error?: string, durationMs = 0) {
  const score = Math.min(39, Math.max(0, Number(row.ghost_score || 0)));
  const alertLevel = score >= 35 ? "watch" : "log";
  Object.assign(row, { ghost_score: score, relevance_score: score, priorityScore: score, alert_level: alertLevel, alertLevel });
  row.analysis_method = "rules_fallback";
  row.rationale = [...(Array.isArray(row.rationale) ? row.rationale : []), `agent_${prompt}=${status}${error ? `:${error}` : ""}`, "agent_fallback_score_cap=39"];
  addTrace(row, prompt, { prompt, version: AGENT_PROMPT_VERSION, model: MODEL, durationMs, status, ...(error ? { error } : {}), toolBudget: { ...TOOL_BUDGET } });
  return row;
}
function number(value: unknown, min: number, max: number) { return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max; }
function strings(value: unknown) { return Array.isArray(value) && value.every(item => typeof item === "string"); }
function evidence(value: unknown) { return Array.isArray(value) && value.length <= 3 && value.every((item) => { const row = object(item); return row && (row.field === "title" || row.field === "summary") && typeof row.quote === "string" && row.quote.trim().length >= 8 && typeof row.claim === "string" && row.claim.trim().length >= 4; }); }
function supportedEvidence(row: Row, items: EventAnalysis["evidence"] | EventCritique["evidence"]) {
  return items.every((item) => String(row[item.field] || "").includes(item.quote));
}
function impacts(value: unknown): value is TickerImpact[] {
  return Array.isArray(value) && value.length <= 40 && value.every((item) => { const row = object(item); return row && typeof row.ticker === "string" && /^[A-Z0-9.\-]{1,15}$/.test(row.ticker) && typeof row.direction === "string" && ["bullish", "bearish", "mixed", "watch"].includes(row.direction) && typeof row.tier === "string" && ["direct", "first_order", "second_order"].includes(row.tier); });
}

export function validateAnalysis(value: unknown, row?: Row): EventAnalysis | null {
  const data = object(value);
  const keys = ["event_type", "is_market_event", "strength", "confidence", "features", "ticker_impacts", "evidence", "conflicts"];
  if (!data || !Object.keys(data).every(key => keys.includes(key)) || typeof data.event_type !== "string" || !(GHOST_TYPES as readonly string[]).includes(data.event_type) || typeof data.is_market_event !== "boolean" || !Number.isInteger(data.strength) || Number(data.strength) < 0 || Number(data.strength) > 3 || !Number.isInteger(data.confidence) || !number(data.confidence, 0, 3) || !object(data.features) || !strings(data.conflicts) || !evidence(data.evidence) || !impacts(data.ticker_impacts)) return null;
  const featureNames = ["event_actuality", "novelty", "surprise", "magnitude", "direct_exposure", "causal_strength", "breadth", "persistence", "uncertainty"];
  const features = object(data.features)!;
  if (!featureNames.every(name => Number.isInteger(features[name]) && number(features[name], 0, 3))) return null;
  const parsed = data as unknown as EventAnalysis;
  if (row && !supportedEvidence(row, parsed.evidence)) return null;
  if (row) {
    const supplied = new Set((Array.isArray(row.symbols) ? row.symbols : []).map(String).map((ticker) => ticker.split(":").pop()!.toUpperCase()));
    if (parsed.ticker_impacts?.some(({ ticker, tier }) => !isTrackedTicker(ticker) || (tier === "direct" && !supplied.has(ticker.toUpperCase())))) return null;
  }
  return parsed;
}

export function validateCritique(value: unknown, row?: Row): EventCritique | null {
  const data = object(value);
  const keys = ["verdict", "confidence", "evidence", "conflicts", "corrections", "unsupported_tickers"];
  const corrections = data && object(data.corrections);
  if (!data || !Object.keys(data).every(key => keys.includes(key)) || typeof data.verdict !== "string" || !["confirm", "downgrade", "reject"].includes(data.verdict) || !Number.isInteger(data.confidence) || !number(data.confidence, 0, 3) || !strings(data.conflicts) || !strings(data.unsupported_tickers) || !evidence(data.evidence) || !corrections || !Object.keys(corrections).every(key => ["event_type", "strength"].includes(key))) return null;
  if (corrections.event_type !== undefined && (typeof corrections.event_type !== "string" || !(GHOST_TYPES as readonly string[]).includes(corrections.event_type))) return null;
  if (corrections.strength !== undefined && (!Number.isInteger(corrections.strength) || Number(corrections.strength) < 0 || Number(corrections.strength) > 3)) return null;
  const parsed = data as unknown as EventCritique;
  return row && !supportedEvidence(row, parsed.evidence) ? null : parsed;
}

async function complete(key: string, messages: ReturnType<typeof analysisMessages> | ReturnType<typeof critiqueMessages>, maxTokens: number) {
  const response = await fetch("https://api.deepseek.com/chat/completions", { method: "POST", signal: AbortSignal.timeout(15_000), headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model: MODEL, temperature: 0, max_tokens: maxTokens, response_format: { type: "json_object" }, messages }) });
  if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
  const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return JSON.parse(payload.choices?.[0]?.message?.content || "{}");
}

export async function reviewEvent(row: Row, key: string | undefined, scoreEvent: ScoreEvent, shouldCritique: ShouldCritique, enabled = true) {
  if (!enabled) return fallback(row, "analysis", "skipped", "not_candidate");
  if (!key) return fallback(row, "analysis", "skipped", "missing_deepseek_key");
  const started = Date.now();
  let analysis: EventAnalysis;
  try {
    analysis = validateAnalysis(await complete(key, analysisMessages(row), 900), row)!;
    if (!analysis) throw new Error("invalid_analysis_json");
    addTrace(row, "analysis", { prompt: "analysis", version: AGENT_PROMPT_VERSION, model: MODEL, durationMs: Date.now() - started, status: "ok", toolBudget: { ...TOOL_BUDGET } });
  } catch (error) { return fallback(row, "analysis", "failed", errorText(error), Date.now() - started); }
  let preliminary: Row;
  try { preliminary = scoreEvent(row, analysis); } catch (error) { return fallback(row, "analysis", "failed", `score:${errorText(error)}`, Date.now() - started); }
  Object.assign(row, preliminary);
  try { if (!shouldCritique(preliminary)) return row; } catch (error) { return fallback(row, "analysis", "failed", `critique_gate:${errorText(error)}`, Date.now() - started); }
  const critiqueStarted = Date.now();
  try {
    const critique = validateCritique(await complete(key, critiqueMessages(row, analysis, preliminary), 600), row);
    if (!critique) throw new Error("invalid_critique_json");
    addTrace(row, "critique", { prompt: "critique", version: AGENT_PROMPT_VERSION, model: MODEL, durationMs: Date.now() - critiqueStarted, status: "ok", toolBudget: { ...TOOL_BUDGET } });
    return Object.assign(row, scoreEvent(row, analysis, critique));
  } catch (error) {
    const score = Math.min(59, Number(preliminary.ghost_score || 0));
    const alertLevel = score >= 35 ? "watch" : "log";
    Object.assign(row, preliminary, {
      ghost_score: score, relevance_score: score, priorityScore: score,
      alert_level: alertLevel, alertLevel, analysis_method: "llm_unreviewed",
      rationale: [...(Array.isArray(preliminary.rationale) ? preliminary.rationale : []), `agent_critique=failed:${errorText(error)}`, "unreviewed_analysis_cap=59"],
    });
    addTrace(row, "critique", { prompt: "critique", version: AGENT_PROMPT_VERSION, model: MODEL, durationMs: Date.now() - critiqueStarted, status: "failed", error: errorText(error), toolBudget: { ...TOOL_BUDGET } });
    return row;
  }
}
