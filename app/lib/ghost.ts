type Direction = "bullish" | "bearish" | "mixed" | "watch";
type LayerSpec = Record<string, Direction>;
type Pattern = string | { term: string; weight: number };

const LAYERS: Record<string, string[]> = {
  hyperscaler: ["META", "MSFT", "GOOGL", "AMZN", "ORCL"],
  accelerator: ["NVDA", "AMD", "AVGO", "MRVL", "INTC", "QCOM", "ANET"],
  foundry_equipment_eda: ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "SNPS", "CDNS"],
  memory_storage: ["MU", "WDC", "SNDK", "STX", "005930.KS", "000660.KS"],
  server_infra: ["SMCI", "DELL", "HPE", "VRT", "ETN", "APH", "GLW"],
  compute_leasing: ["CRWV", "NBIS"], power_cooling: ["CEG", "VST", "NRG", "PWR", "TT", "CARR"],
  basket: ["SMH", "SOXX", "QQQ", "XLK"],
};

const TYPES: Record<string, { keywords: Pattern[]; layers: LayerSpec }> = {
  compute_overcapacity: { keywords: [{ term: "excess ai compute", weight: 4 }, { term: "excess compute", weight: 4 }, { term: "overcapacity", weight: 3 }, { term: "low utilization", weight: 3 }, "excess capacity", "sell compute", "compute glut"], layers: { hyperscaler: "mixed", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", compute_leasing: "bearish", power_cooling: "bearish", basket: "bearish" } },
  capex_roi_doubt: { keywords: [{ term: "return on investment", weight: 3 }, { term: "free cash flow pressure", weight: 3 }, { term: "monetization weak", weight: 3 }, { term: "capex too high", weight: 3 }, "overspending", "spending concerns", "ai spending", "cheaper model", "efficiency shock", "profit delay"], layers: { hyperscaler: "bearish", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" } },
  order_inventory_weakness: { keywords: [{ term: "order cut", weight: 4 }, { term: "orders cut", weight: 4 }, { term: "cancelled order", weight: 3 }, { term: "backlog weakness", weight: 3 }, "inventory build", "lead time down", "selloff", "rout", "slump", "tumbling"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" } },
  hbm_shortage: { keywords: [{ term: "hbm shortage", weight: 4 }, { term: "memory shortage", weight: 3 }, { term: "sold out", weight: 3 }, "price hike", "allocation", "supply tight", "reserved supply"], layers: { memory_storage: "bullish", foundry_equipment_eda: "bullish", accelerator: "mixed", basket: "bullish" } },
  capacity_flood: { keywords: [{ term: "massive investment", weight: 3 }, { term: "capacity expansion", weight: 3 }, { term: "supply flood", weight: 3 }, "new fabs", "price war", "production capacity"], layers: { memory_storage: "bearish", foundry_equipment_eda: "bullish", accelerator: "bullish", basket: "mixed" } },
  data_center_delay: { keywords: [{ term: "data center delay", weight: 4 }, { term: "lease cancellation", weight: 3 }, { term: "power constraint", weight: 3 }, "permitting delay", "grid constraint"], layers: { hyperscaler: "bearish", compute_leasing: "bearish", server_infra: "mixed", power_cooling: "bullish" } },
  financing_stress: { keywords: [{ term: "negative free cash flow", weight: 4 }, { term: "debt financing", weight: 3 }, { term: "refinancing", weight: 3 }, "equity raise", "customer concentration"], layers: { compute_leasing: "bearish", server_infra: "bearish", basket: "bearish" } },
  capital_markets_memory: { keywords: [{ term: "ai memory trade", weight: 4 }, { term: "nasdaq listing", weight: 3 }, { term: "us listing", weight: 3 }, { term: "adr listing", weight: 3 }, "public offering"], layers: { memory_storage: "mixed", basket: "mixed" } },
  export_regulatory: { keywords: [{ term: "export control", weight: 4 }, { term: "sanction", weight: 3 }, { term: "antitrust", weight: 3 }, "restriction", "doj", "ftc", "eu probe", "export license"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", basket: "bearish" } },
};

const SOURCE_3 = ["sec", "company ir", "earnings call", "reuters", "bloomberg", "dow jones"];
const SOURCE_2 = ["wall street journal", "wsj", "financial times", "cnbc", "techcrunch", "business insider", "fortune", "barron", "yahoo", "alpha vantage", "finnhub"];
const highNovelty = ["reportedly", "plans to", "announced", "first", "new", "unexpected", "cuts", "sold out", "listing", "offering"];
const weakNews = ["position in", "stake in", "shares of", "holdings", "price target", "most important ai stocks", "best stocks to buy", "stock to buy", "rating"];

function level(score: number) { return score >= 60 ? "alert" : score >= 20 ? "watch" : "log"; }
function matchPatterns(text: string, patterns: Pattern[]) {
  const hits: string[] = [];
  let score = 0;
  for (const pattern of patterns) {
    const term = typeof pattern === "string" ? pattern : pattern.term;
    if (!text.includes(term)) continue;
    hits.push(term);
    score += typeof pattern === "string" ? 1 : pattern.weight;
  }
  return { hits, score };
}

function score100(parts: { credibility: number; novelty: number; theme: number; contagion: number; marketConfirmation: number; evidence: number; weakPenalty: number }) {
  return Math.max(0, Math.min(100, Math.round(
    (parts.credibility / 3) * 15 +
    (parts.novelty / 3) * 15 +
    (parts.theme / 3) * 20 +
    (parts.contagion / 3) * 15 +
    (parts.marketConfirmation / 3) * 10 +
    (Math.min(8, parts.evidence) / 8) * 25 -
    parts.weakPenalty
  )));
}

function impactFor(ghostType: string, symbols: string[]) {
  const spec = TYPES[ghostType];
  const affected = new Set<string>(spec ? Object.keys(spec.layers) : []);
  for (const [layer, names] of Object.entries(LAYERS)) if (names.some(s => symbols.includes(s))) affected.add(layer);
  const directions: Record<string, Direction> = {};
  for (const layer of affected) for (const symbol of LAYERS[layer] || []) directions[symbol] = spec?.layers[layer] || "watch";
  return { affected: [...affected].sort(), directions };
}

export function applySemanticJudgment(row: Record<string, any>, judgment: Record<string, any>) {
  const type = String(judgment.ghost_type || "");
  const strength = Math.max(0, Math.min(3, Number(judgment.strength || 0)));
  if (!(type in TYPES) && type !== "ordinary_ai_news") return row;

  if (type === "ordinary_ai_news" && strength <= 1) {
    row.ghost_type = type;
    row.ghost_score = Math.min(Number(row.ghost_score || 0), 19);
    row.alert_level = level(row.ghost_score);
  } else if (strength >= 2) {
    row.ghost_type = type;
    const impact = impactFor(type, row.symbols || []);
    row.affected_layers = impact.affected;
    row.ticker_directions = impact.directions;
    row.ghost_score = Math.max(Number(row.ghost_score || 0), Math.min(100, Math.round(strength * 20 + row.credibility * 5 + Math.min(3, impact.affected.length) * 5)));
    row.alert_level = level(row.ghost_score);
  }

  row.analysis_method = "llm_assisted_rules";
  row.rationale = [
    ...(row.rationale || []),
    `semantic_type=${type}`,
    `semantic_strength=${strength}`,
    judgment.reason ? `semantic_reason=${String(judgment.reason).slice(0, 160)}` : "semantic_reason=none",
  ];
  return row;
}

export function analyze(raw: Record<string, any>) {
  const title = String(raw.title || raw.headline || "");
  const summary = String(raw.summary || raw.description || "");
  const text = `${title} ${summary}`.toLowerCase();
  let ghostType = "ordinary_ai_news", hits: string[] = [], evidence = 0;
  for (const [type, spec] of Object.entries(TYPES)) {
    const found = matchPatterns(text, spec.keywords);
    if (found.score > evidence) [ghostType, hits, evidence] = [type, found.hits, found.score];
  }
  const explicit = (raw.symbols || raw.tickers || []).map((s: string) => String(s).split(":").pop()!.toUpperCase());
  const upper = text.toUpperCase();
  const symbols = [...new Set([...explicit, ...Object.values(LAYERS).flat().filter(s => new RegExp(`\\b${s.replace(".", "\\.")}\\b`).test(upper))])].sort();
  const impact = impactFor(ghostType, symbols);
  const source = String(raw.source || "unknown");
  const s = source.toLowerCase();
  const credibility = SOURCE_3.some(x => s.includes(x)) ? 3 : SOURCE_2.some(x => s.includes(x)) ? 2 : 1;
  const novelty = highNovelty.some(x => text.includes(x)) ? 3 : ["concern", "could", "may", "watch", "analyst"].some(x => text.includes(x)) ? 2 : 1;
  const theme = evidence >= 3 || ["compute", "capex", "gpu", "hbm", "data center", "memory", "ai infrastructure"].some(x => text.includes(x)) ? 3 : /\b(ai|chip|semiconductor)\b/.test(text) ? 2 : 1;
  const contagion = Math.min(3, Math.max(1, impact.affected.length));
  const marketConfirmation = raw.market && Object.keys(raw.market).length ? 2 : 1;
  const weakPenalty = weakNews.some(x => text.includes(x)) && evidence < 3 ? 25 : 0;
  const ghostScore = score100({ credibility, novelty, theme, contagion, marketConfirmation, evidence, weakPenalty });
  return { title, summary, source, ghost_type: ghostType, credibility, novelty, theme_strength: theme, contagion, market_confirmation: marketConfirmation, ghost_score: ghostScore, alert_level: level(ghostScore), symbols, affected_layers: impact.affected, ticker_directions: impact.directions, rationale: [`type=${ghostType}`, `source_credibility=${credibility}`, `evidence_score=${evidence}`, `matched_keywords=${hits.join(", ") || "none"}`, `affected_layers=${impact.affected.join(", ") || "none"}`, weakPenalty ? "weak_event_penalty=25" : "weak_event_penalty=0"], url: raw.url || "", published_at: raw.published_at || raw.time_published || new Date().toISOString(), analysis_method: "weighted_rules", direction_reasons: {}, ml_predictions: {} };
}

export function normalizeArticle(article: Record<string, any>) {
  const symbols = (article.ticker_sentiment || []).map((x: any) => String(x.ticker || "").split(":").pop()).filter(Boolean);
  return analyze({ title: article.title, summary: article.summary, source: article.source || "Alpha Vantage", published_at: article.time_published, url: article.url, symbols });
}
