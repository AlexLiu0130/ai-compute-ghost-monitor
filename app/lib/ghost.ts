type Direction = "bullish" | "bearish" | "mixed" | "watch";
type LayerSpec = Record<string, Direction>;

const LAYERS: Record<string, string[]> = {
  hyperscaler: ["META", "MSFT", "GOOGL", "AMZN", "ORCL"],
  accelerator: ["NVDA", "AMD", "AVGO", "MRVL", "INTC", "QCOM", "ANET"],
  foundry_equipment_eda: ["TSM", "ASML", "AMAT", "LRCX", "KLAC", "SNPS", "CDNS"],
  memory_storage: ["MU", "WDC", "SNDK", "STX", "005930.KS", "000660.KS"],
  server_infra: ["SMCI", "DELL", "HPE", "VRT", "ETN", "APH", "GLW"],
  compute_leasing: ["CRWV", "NBIS"], power_cooling: ["CEG", "VST", "NRG", "PWR", "TT", "CARR"],
  basket: ["SMH", "SOXX", "QQQ", "XLK"],
};

const TYPES: Record<string, { keywords: string[]; layers: LayerSpec }> = {
  compute_overcapacity: { keywords: ["excess compute", "excess ai compute", "excess capacity", "sell compute", "low utilization", "overcapacity", "compute glut"], layers: { hyperscaler: "mixed", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", compute_leasing: "bearish", power_cooling: "bearish", basket: "bearish" } },
  capex_roi_doubt: { keywords: ["return on investment", "overspending", "capex too high", "free cash flow pressure", "monetization weak", "spending concerns", "ai spending", "cheaper model", "efficiency shock"], layers: { hyperscaler: "bearish", accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" } },
  order_inventory_weakness: { keywords: ["order cut", "orders cut", "inventory build", "lead time down", "backlog weakness", "cancelled order", "selloff", "rout", "slump", "tumbling"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", memory_storage: "bearish", server_infra: "bearish", basket: "bearish" } },
  hbm_shortage: { keywords: ["hbm shortage", "sold out", "memory shortage", "price hike", "allocation", "supply tight", "reserved supply"], layers: { memory_storage: "bullish", foundry_equipment_eda: "bullish", accelerator: "mixed", basket: "bullish" } },
  capacity_flood: { keywords: ["new fabs", "capacity expansion", "supply flood", "price war", "massive investment", "production capacity"], layers: { memory_storage: "bearish", foundry_equipment_eda: "bullish", accelerator: "bullish", basket: "mixed" } },
  data_center_delay: { keywords: ["data center delay", "lease cancellation", "power constraint", "permitting delay", "grid constraint"], layers: { hyperscaler: "bearish", compute_leasing: "bearish", server_infra: "mixed", power_cooling: "bullish" } },
  financing_stress: { keywords: ["debt financing", "equity raise", "negative free cash flow", "customer concentration", "refinancing"], layers: { compute_leasing: "bearish", server_infra: "bearish", basket: "bearish" } },
  capital_markets_memory: { keywords: ["nasdaq listing", "us listing", "adr listing", "public offering", "ai memory trade"], layers: { memory_storage: "mixed", basket: "mixed" } },
  export_regulatory: { keywords: ["export control", "restriction", "sanction", "antitrust", "doj", "ftc", "eu probe"], layers: { accelerator: "bearish", foundry_equipment_eda: "bearish", basket: "bearish" } },
};

const SOURCE_3 = ["sec", "company ir", "earnings call", "reuters", "bloomberg", "dow jones"];
const SOURCE_2 = ["wall street journal", "wsj", "financial times", "cnbc", "techcrunch", "business insider", "fortune", "barron", "yahoo", "alpha vantage", "finnhub"];
const highNovelty = ["reportedly", "plans to", "announced", "first", "new", "unexpected", "cuts", "sold out", "listing", "offering"];

function normalizeScore(raw: number) { return raw <= 1 ? 0 : Math.max(0, Math.min(100, Math.round(((raw - 1) / 242) ** .45 * 100))); }
function level(score: number) { return score >= 60 ? "alert" : score >= 20 ? "watch" : "log"; }

export function analyze(raw: Record<string, any>) {
  const title = String(raw.title || raw.headline || "");
  const summary = String(raw.summary || raw.description || "");
  const text = `${title} ${summary}`.toLowerCase();
  let ghostType = "ordinary_ai_news", hits: string[] = [];
  for (const [type, spec] of Object.entries(TYPES)) {
    const found = spec.keywords.filter(k => text.includes(k));
    if (found.length > hits.length) [ghostType, hits] = [type, found];
  }
  const explicit = (raw.symbols || raw.tickers || []).map((s: string) => String(s).split(":").pop()!.toUpperCase());
  const upper = text.toUpperCase();
  const symbols = [...new Set([...explicit, ...Object.values(LAYERS).flat().filter(s => new RegExp(`\\b${s.replace(".", "\\.")}\\b`).test(upper))])].sort();
  const spec = TYPES[ghostType];
  const affected = new Set<string>(spec ? Object.keys(spec.layers) : []);
  for (const [layer, names] of Object.entries(LAYERS)) if (names.some(s => symbols.includes(s))) affected.add(layer);
  const directions: Record<string, Direction> = {};
  for (const layer of affected) for (const symbol of LAYERS[layer] || []) directions[symbol] = spec?.layers[layer] || "watch";
  const source = String(raw.source || "unknown");
  const s = source.toLowerCase();
  const credibility = SOURCE_3.some(x => s.includes(x)) ? 3 : SOURCE_2.some(x => s.includes(x)) ? 2 : 1;
  const novelty = highNovelty.some(x => text.includes(x)) ? 3 : ["concern", "could", "may", "watch", "analyst"].some(x => text.includes(x)) ? 2 : 1;
  const theme = hits.length || ["compute", "capex", "gpu", "hbm", "data center", "memory", "ai infrastructure"].some(x => text.includes(x)) ? 3 : /\b(ai|chip|semiconductor)\b/.test(text) ? 2 : 1;
  const contagion = Math.min(3, Math.max(1, affected.size));
  const marketConfirmation = raw.market && Object.keys(raw.market).length ? 2 : 1;
  const ghostScore = normalizeScore(credibility * novelty * theme * contagion * marketConfirmation);
  return { title, summary, source, ghost_type: ghostType, credibility, novelty, theme_strength: theme, contagion, market_confirmation: marketConfirmation, ghost_score: ghostScore, alert_level: level(ghostScore), symbols, affected_layers: [...affected].sort(), ticker_directions: directions, rationale: [`type=${ghostType}`, `source_credibility=${credibility}`, `matched_keywords=${hits.join(", ") || "none"}`, `affected_layers=${[...affected].join(", ") || "none"}`], url: raw.url || "", published_at: raw.published_at || raw.time_published || new Date().toISOString(), analysis_method: "rules", direction_reasons: {}, ml_predictions: {} };
}

export function normalizeArticle(article: Record<string, any>) {
  const symbols = (article.ticker_sentiment || []).map((x: any) => String(x.ticker || "").split(":").pop()).filter(Boolean);
  return analyze({ title: article.title, summary: article.summary, source: article.source || "Alpha Vantage", published_at: article.time_published, url: article.url, symbols });
}
