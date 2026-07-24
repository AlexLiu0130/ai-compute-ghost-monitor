export type Direction = "bullish" | "bearish" | "mixed" | "watch";
export const SCORING_VERSION = "anchored-v4";
export type ImpactTier = "direct" | "first_order" | "second_order";
export type Evidence = { field: "title" | "summary"; quote: string; claim: string };
export type EventAnalysis = {
  event_type: string;
  is_market_event: boolean;
  strength: number;
  confidence: number;
  features: Record<string, number>;
  ticker_impacts?: TickerImpact[];
  evidence: Evidence[];
  conflicts: string[];
};
export type EventCritique = {
  verdict: "confirm" | "downgrade" | "reject";
  confidence: number;
  evidence: Evidence[];
  conflicts: string[];
  corrections: { event_type?: string; strength?: number };
  unsupported_tickers?: string[];
};
export type Critique = EventCritique;
export type TickerImpact = { ticker: string; direction: Direction; tier: ImpactTier };
export type ScoreResult = {
  relevance_score: number;
  priorityScore: number;
  eventConfidence: number;
  impactPotential: number;
  directionConfidence: number;
  alert_level: "alert" | "watch" | "log";
  alertLevel: "alert" | "watch" | "log";
  ghost_type: string;
  ticker_impacts: TickerImpact[];
  impacts: TickerImpact[];
  ticker_directions: Record<string, Direction>;
  evidence: Evidence[];
  conflicts: string[];
  rationale: string[];
  score_critique: { inScope: boolean; hardGates: string[]; penalties: string[]; caps: string[]; llmFeatures: EventAnalysis | null };
  critique: { inScope: boolean; hardGates: string[]; penalties: string[]; caps: string[]; llmFeatures: EventAnalysis | null };
  [key: string]: unknown;
};

type Row = Record<string, unknown>;
type Context = { prior_events?: Array<{ title?: string }>; evidence?: Array<{ claim?: string; stance?: string }> };
type Pattern = string | { term: string; weight: number };
type LayerSpec = Record<string, Direction>;

const LAYERS: Record<string, string[]> = {
  hyperscaler: ["META", "MSFT", "GOOGL", "AMZN", "ORCL"], accelerator: ["NVDA", "AMD", "AVGO", "MRVL", "INTC", "QCOM", "ANET"],
  foundry_equipment_eda: ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "SNPS", "CDNS"], memory_storage: ["MU", "WDC", "SNDK", "STX", "005930.KS", "000660.KS"],
  server_infra: ["SMCI", "DELL", "HPE", "VRT", "ETN", "APH", "GLW"], compute_leasing: ["CRWV", "NBIS"], power_cooling: ["CEG", "VST", "NRG", "PWR", "TT", "CARR"], basket: ["SMH", "SOXX", "QQQ", "XLK"],
};
const TRACKED_TICKERS = new Set(Object.values(LAYERS).flat());
export function isTrackedTicker(ticker: string) { return TRACKED_TICKERS.has(ticker.toUpperCase()); }
export const trackedTickers = () => [...TRACKED_TICKERS];
const TYPES: Record<string, { keywords: Pattern[]; layers: LayerSpec; firstOrder: string[] }> = {
  compute_overcapacity: { keywords: [{ term: "excess ai compute", weight: 4 }, { term: "excess compute", weight: 4 }, { term: "overcapacity", weight: 3 }, { term: "low utilization", weight: 3 }, "excess capacity", "sell excess", "unused gpu"], layers: { hyperscaler: "mixed", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", compute_leasing: "bearish", power_cooling: "bearish", basket: "bearish" }, firstOrder: ["accelerator", "foundry_equipment_eda", "memory_storage", "server_infra", "compute_leasing"] },
  capex_roi_doubt: { keywords: [{ term: "return on investment", weight: 3 }, { term: "free cash flow pressure", weight: 3 }, { term: "monetization weak", weight: 3 }, { term: "capex too high", weight: 3 }, "overspending", "spending concerns", "ai spending", "cheaper model", "efficiency shock", "profit delay"], layers: { hyperscaler: "bearish", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" }, firstOrder: ["accelerator", "foundry_equipment_eda", "memory_storage", "server_infra"] },
  order_inventory_weakness: { keywords: [{ term: "order cut", weight: 4 }, { term: "orders cut", weight: 4 }, { term: "cancelled order", weight: 3 }, { term: "backlog weakness", weight: 3 }, "inventory build", "lead time down", "selloff", "rout", "slump", "tumbling"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" }, firstOrder: ["accelerator", "foundry_equipment_eda", "memory_storage", "server_infra"] },
  hbm_shortage: { keywords: [{ term: "hbm shortage", weight: 4 }, { term: "memory shortage", weight: 3 }, { term: "sold out", weight: 3 }, "price hike", "allocation", "supply tight", "reserved supply"], layers: { memory_storage: "bullish", foundry_equipment_eda: "bullish", accelerator: "mixed", basket: "bullish" }, firstOrder: ["memory_storage", "accelerator"] },
  capacity_flood: { keywords: [{ term: "massive investment", weight: 3 }, { term: "capacity expansion", weight: 3 }, { term: "supply flood", weight: 3 }, "new fabs", "price war", "production capacity"], layers: { memory_storage: "bearish", foundry_equipment_eda: "bullish", accelerator: "bullish", basket: "mixed" }, firstOrder: ["memory_storage", "foundry_equipment_eda", "accelerator"] },
  demand_order_strength: { keywords: [{ term: "record backlog", weight: 4 }, { term: "backlog reached a record", weight: 4 }, { term: "raises guidance", weight: 4 }, { term: "raises gross margin", weight: 4 }, { term: "gross margin outlook", weight: 3 }, { term: "margin guidance", weight: 3 }, { term: "strong ai demand", weight: 3 }, "orders surged", "order growth"], layers: { accelerator: "bullish", memory_storage: "bullish", server_infra: "bullish", basket: "bullish" }, firstOrder: ["accelerator", "memory_storage", "server_infra"] },
  data_center_delay: { keywords: [{ term: "data center delay", weight: 4 }, { term: "lease cancellation", weight: 3 }, { term: "power constraint", weight: 3 }, "permitting delay", "grid constraint"], layers: { hyperscaler: "bearish", compute_leasing: "bearish", server_infra: "mixed", power_cooling: "bullish" }, firstOrder: ["compute_leasing", "server_infra"] },
  financing_stress: { keywords: [{ term: "negative free cash flow", weight: 4 }, { term: "debt financing", weight: 3 }, { term: "refinancing", weight: 3 }, "equity raise", "customer concentration"], layers: { compute_leasing: "bearish", server_infra: "bearish", basket: "bearish" }, firstOrder: ["compute_leasing", "server_infra"] },
  capital_markets_memory: { keywords: [{ term: "ai memory trade", weight: 4 }, { term: "nasdaq listing", weight: 3 }, { term: "us listing", weight: 3 }, { term: "adr listing", weight: 3 }, "public offering"], layers: { memory_storage: "mixed", basket: "mixed" }, firstOrder: ["memory_storage"] },
  export_regulatory: { keywords: [{ term: "export control", weight: 4 }, { term: "sanction", weight: 3 }, { term: "antitrust", weight: 3 }, "restriction", "doj", "ftc", "eu probe", "export license"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", basket: "bearish" }, firstOrder: ["accelerator", "foundry_equipment_eda"] },
};
const COMPUTE = ["ai compute", "ai infrastructure", "gpu", "accelerator", "hbm", "data center", "cloud capacity", "compute capacity", "semiconductor", "memory chip", "server", "hyperscaler", "foundry", "fab", "capex", "chip demand", "ai spending"];
const HOLDING = ["position in", "stake in", "shares of", "holdings", "price target", "stock to buy", "buy rating", "top picks", "analyst rating"];
const CROSS_INDUSTRY = ["advertising campaign", "target cpa", "marketing", "human resources", "legal tech", "freight-market", "truck orders", "employee equity", "compensation plan"];
const HIGH_QUALITY = ["sec", "company ir", "earnings call", "reuters", "bloomberg", "dow jones"];
const MID_QUALITY = ["wall street journal", "wsj", "financial times", "cnbc", "techcrunch", "business insider", "fortune", "barron"];
const NOVEL = ["reportedly", "plans to", "announced", "first", "new", "unexpected", "cuts", "sold out", "listing", "offering"];
const ALIASES: Record<string, string[]> = { META: ["meta"], "000660.KS": ["sk hynix", "hynix"], MU: ["micron"], NVDA: ["nvidia"], AMD: ["amd"], ASML: ["asml"], CEG: ["constellation energy"] };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const textOf = (value: unknown) => value == null ? "" : String(value);
const valuesOf = (value: unknown) => Array.isArray(value) ? value : [];
const recordOf = (value: unknown): Record<string, unknown> | null => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const level = (score: number): ScoreResult["alert_level"] => score >= 65 ? "alert" : score >= 35 ? "watch" : "log";
const quality = (source: string) => HIGH_QUALITY.some((term) => source.includes(term)) ? 3 : MID_QUALITY.some((term) => source.includes(term)) ? 2 : 1;

function classify(text: string) {
  let eventType = "ordinary_ai_news", evidence = 0, hits: string[] = [];
  for (const [type, spec] of Object.entries(TYPES)) {
    const found = spec.keywords.reduce((sum, pattern) => sum + (text.includes(typeof pattern === "string" ? pattern : pattern.term) ? typeof pattern === "string" ? 1 : pattern.weight : 0), 0);
    if (found > evidence) { eventType = type; evidence = found; hits = spec.keywords.map((pattern) => typeof pattern === "string" ? pattern : pattern.term).filter((term) => text.includes(term)); }
  }
  return { eventType, evidence, hits };
}

function duplicate(title: string, prior: Context["prior_events"]) {
  const words = new Set(title.toLowerCase().match(/[a-z]{4,}/g) || []);
  return valuesOf(prior).some((event) => {
    const priorWords = new Set(textOf((event as { title?: string }).title).toLowerCase().match(/[a-z]{4,}/g) || []);
    let overlap = 0; for (const word of words) if (priorWords.has(word)) overlap += 1;
    return overlap >= 3;
  });
}

function impacts(type: string, symbols: string[], text: string): TickerImpact[] {
  const spec = TYPES[type];
  if (!spec) return [];
  const direct = new Set(symbols.filter((symbol) => (ALIASES[symbol] || []).some((alias) => text.includes(alias))));
  return symbols.flatMap((ticker) => {
    const layer = Object.entries(LAYERS).find(([, members]) => members.includes(ticker))?.[0];
    const direction = layer ? spec.layers[layer] : undefined;
    if (!direction) return [];
    return [{ ticker, direction, tier: direct.has(ticker) ? "direct" : layer && spec.firstOrder.includes(layer) ? "first_order" : "second_order" } satisfies TickerImpact];
  });
}

const anchored = (value: unknown, fallback = 0, legacyContinuous = false) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  // Compatibility for persisted pre-v3 0..1 semantic labels.
  return clamp(Math.round(legacyContinuous && number >= 0 && number <= 1 ? number * 3 : number), 0, 3);
};

function componentScores(analysis: EventAnalysis | undefined, sourceQuality: number, semanticStrength: number, novelty: number, evidenceLevel: number) {
  const legacyContinuous = Boolean(analysis && Object.values(analysis.features).some((value) => Number(value) > 0 && Number(value) < 1 && !Number.isInteger(value)));
  const feature = (name: string, fallback: number) => anchored(analysis?.features[name], fallback, legacyContinuous);
  const confidence = anchored(analysis?.confidence, semanticStrength, legacyContinuous);
  const uncertainty = feature("uncertainty", 0);
  const eventConfidence = clamp(Math.round(((feature("event_actuality", semanticStrength) * 4 + confidence * 3 + sourceQuality * 2 + evidenceLevel * 3) / 36) * 100 - (uncertainty / 3) * 20), 0, 100);
  const impactPotential = clamp(Math.round(((feature("magnitude", semanticStrength) * 3 + feature("direct_exposure", 1) * 2 + feature("surprise", novelty) * 2 + feature("breadth", 1) * 2 + feature("persistence", 1) * 2 + feature("novelty", novelty)) / 36) * 100), 0, 100);
  const directionConfidence = clamp(Math.round(((feature("causal_strength", semanticStrength) * 5 + evidenceLevel * 2 + (3 - uncertainty) * 2) / 27) * 100), 0, 100);
  return { eventConfidence, impactPotential, directionConfidence };
}

/** Deterministic final scorer. LLM analysis/critique are bounded features, never a score. */
export function scoreEvent(row: Row, analysisOrContext?: EventAnalysis | Context, critique?: EventCritique, suppliedContext: Context = {}): ScoreResult {
  const analysis = analysisOrContext && "event_type" in analysisOrContext ? analysisOrContext as EventAnalysis : undefined;
  const context = analysis ? suppliedContext : analysisOrContext as Context || {};
  const title = textOf(row.title || row.headline); const summary = textOf(row.summary || row.description); const text = `${title} ${summary}`.toLowerCase();
  const source = textOf(row.source || "unknown").toLowerCase(); const symbols = valuesOf(row.symbols || row.tickers).map(textOf).map((symbol) => symbol.split(":").pop()!.toUpperCase());
  const classified = classify(text); const suppliedType = textOf(row.eventType); const supplied = suppliedType in TYPES;
  if (supplied) { classified.eventType = suppliedType; classified.evidence = clamp(Number(row.keywordEvidence || 0), 0, 8); classified.hits = valuesOf(row.keywordHits).map(textOf); }
  const gates: string[] = []; const caps: string[] = []; const penalties: string[] = [];
  const computeHits = COMPUTE.filter((term) => text.includes(term)); const holding = HOLDING.find((term) => text.includes(term)); const cross = CROSS_INDUSTRY.find((term) => text.includes(term));
  const duplicateEvent = Boolean(row.duplicate || row.is_duplicate || row.duplicate_of) || duplicate(title, context.prior_events); const conflicts = [...(row.conflict ? ["row_conflict"] : []), ...valuesOf(context.evidence).filter((item) => (item as { stance?: string }).stance === "contradicts").map((item) => textOf((item as { claim?: string }).claim)), ...valuesOf(analysis?.conflicts), ...valuesOf(critique?.conflicts)].filter(Boolean).map(textOf);
  if (!computeHits.length && classified.evidence < 3 && !analysis?.is_market_event) gates.push("not_ai_compute");
  if (holding) gates.push(`holding_or_promotion:${holding}`);
  if (cross) gates.push(`cross_industry:${cross}`);
  if (duplicateEvent) caps.push("duplicate_cap=10");
  let ghostType = classified.eventType;
  const semanticType = critique?.corrections.event_type || analysis?.event_type;
  if (ghostType === "ordinary_ai_news" && analysis?.is_market_event && semanticType && semanticType in TYPES) ghostType = semanticType;
  if (critique?.verdict === "reject") gates.push("critique_rejected");
  if (analysis && !analysis.is_market_event) gates.push("no_market_event_evidence");
  if (!summary.trim()) { caps.push("no_body_cap=35"); }
  if (quality(source) === 1 && valuesOf(row.sources).length <= 1) caps.push("low_quality_single_source_cap=49");
  if (conflicts.length) caps.push("conflicting_sources_cap=59");
  if (gates.length) { ghostType = "ordinary_ai_news"; caps.push("hard_gate_cap=0"); }
  const embeddedLlm = recordOf(row.llm); const semanticStrength = clamp(Number(critique?.corrections.strength ?? analysis?.strength ?? embeddedLlm?.strength ?? 0), 0, 3);
  const novelty = NOVEL.some((term) => text.includes(term)) ? 3 : 1;
  const components = componentScores(analysis, quality(source), semanticStrength, novelty, analysis?.evidence.length ? 3 : classified.evidence >= 3 ? 2 : computeHits.length ? 1 : 0);
  let relevance = components.eventConfidence * 0.45 + components.impactPotential * 0.45 + components.directionConfidence * 0.1;
  if (analysis && analysis.evidence.length === 0) { relevance = Math.min(relevance, 34); caps.push("missing_evidence_cap=34"); }
  if (analysis && anchored(analysis.confidence, 0, Object.values(analysis.features).some((value) => Number(value) > 0 && Number(value) < 1 && !Number.isInteger(value))) < 2) { relevance = Math.min(relevance, 59); caps.push("low_analysis_confidence_cap=59"); }
  if (critique?.verdict === "downgrade") { relevance = Math.min(relevance - 15, 59); penalties.push("critic_downgrade=-15"); }
  if (!summary.trim()) relevance = Math.min(relevance, 35);
  if (quality(source) === 1 && Number(row.sourceCount || valuesOf(row.sources).length || 1) <= 1) relevance = Math.min(relevance, 49);
  if (duplicateEvent) relevance = Math.min(relevance, 10);
  if (conflicts.length) relevance = Math.min(relevance, 59);
  if (gates.length) relevance = 0;
  relevance = clamp(Math.round(relevance), 0, 100);
  if (!row.market) penalties.push("market_confirmation=pending");
  const directSymbols = valuesOf(row.directSymbols).map(textOf); const suppliedDirections = recordOf(row.tickerDirections);
  const agentImpacts = valuesOf(analysis?.ticker_impacts)
    .filter((impact): impact is TickerImpact => Boolean(impact && typeof impact === "object"))
    .map(({ ticker, direction, tier }) => ({ ticker: ticker.toUpperCase(), direction, tier }));
  const unsupported = new Set(valuesOf(critique?.unsupported_tickers).map(textOf).map((ticker) => ticker.toUpperCase()));
  const tickerImpacts = gates.length || conflicts.length || duplicateEvent ? [] : (agentImpacts.length ? agentImpacts : suppliedDirections ? Object.entries(suppliedDirections).map(([ticker, direction]) => ({ ticker, direction: direction as Direction, tier: directSymbols.includes(ticker) ? "direct" : ["SMH", "SOXX", "QQQ", "XLK"].includes(ticker) ? "second_order" : "first_order" } satisfies TickerImpact)) : impacts(ghostType, symbols, text)).filter(({ ticker }) => !unsupported.has(ticker));
  const alertLevel = conflicts.length ? "watch" : level(relevance);
  const evidence = [...valuesOf(analysis?.evidence), ...valuesOf(critique?.evidence)] as Evidence[];
  return {
    ...row, relevance_score: relevance, priorityScore: relevance, ...components,
    alert_level: alertLevel, alertLevel, ghost_type: ghostType, ticker_impacts: tickerImpacts, impacts: tickerImpacts, ticker_directions: Object.fromEntries(tickerImpacts.map(({ ticker, direction }) => [ticker, direction])),
    evidence, conflicts, rationale: [`type=${ghostType}`, "score_basis=deterministic_anchored_components", `rule_evidence=${classified.evidence}`, ...classified.hits.map((hit) => `keyword=${hit}`), ...gates, ...caps, ...penalties],
    score_critique: { inScope: !gates.length, hardGates: gates, penalties, caps, llmFeatures: analysis || null }, critique: { inScope: !gates.length, hardGates: gates, penalties, caps, llmFeatures: analysis || null },
    ghost_score: relevance, alert_level_legacy: alertLevel, affected_layers: Object.keys(TYPES[ghostType]?.layers || {}), analysis_method: analysis ? "llm" : "deterministic_rules", scoring_method: analysis ? "deterministic_anchored_llm_labels" : "deterministic_rules", scoring_version: SCORING_VERSION,
  };
}

export function shouldCritique(result: Record<string, unknown>) {
  return Number(result.relevance_score || result.ghost_score || 0) >= 40 && !valuesOf(result.score_critique && (result.score_critique as { hardGates?: unknown }).hardGates).length;
}
