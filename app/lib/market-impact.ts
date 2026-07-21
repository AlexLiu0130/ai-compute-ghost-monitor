type Row = Record<string, unknown>;

type PriceBar = {
  date: string;
  close: number;
};

type MarketImpact = {
  symbol: string;
  prev_date?: string;
  reaction_trade_date?: string;
  prev_close?: number;
  reaction_close?: number;
  next_close?: number | null;
  reaction_pct?: number;
  next_day_pct?: number | null;
  three_session_pct?: number | null;
  pending?: "waiting_for_reaction_close";
  expected_reaction_date?: string;
  error?: string;
};

const US_MARKET_HOLIDAYS = new Set([
  "2024-01-01", "2024-01-15", "2024-02-19", "2024-03-29", "2024-05-27", "2024-06-19", "2024-07-04", "2024-09-02", "2024-11-28", "2024-12-25",
  "2025-01-01", "2025-01-09", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01", "2025-11-27", "2025-12-25",
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03", "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07", "2026-11-26", "2026-12-25",
]);

const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const pct = (before: number, after: number) => round((after / before - 1) * 100);

function addDays(value: string, days: number) {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isUsTradingDay(value: string) {
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6 && !US_MARKET_HOLIDAYS.has(value);
}

function isTradingDay(value: string, symbol = "") {
  if (!symbol.endsWith(".KS")) return isUsTradingDay(value);
  const day = new Date(`${value}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
}

function nextTradingDay(value: string, symbol = "") {
  let day = value;
  while (!isTradingDay(day, symbol)) day = addDays(day, 1);
  return day;
}

function previousTradingDay(value: string, symbol = "") {
  let day = value;
  while (!isTradingDay(day, symbol)) day = addDays(day, -1);
  return day;
}

function parsePublishedAt(value: unknown) {
  const raw = String(value || "");
  if (/^\d{8}T\d{6}$/.test(raw)) {
    return new Date(`${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`);
  }
  return new Date(raw);
}

function marketParts(value: Date, symbol = "") {
  const korean = symbol.endsWith(".KS");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: korean ? "Asia/Seoul" : "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return { date: `${part("year")}-${part("month")}-${part("day")}`, hour: Number(part("hour")) };
}

export function expectedReactionDate(publishedAt: unknown, symbol = "") {
  const parsed = parsePublishedAt(publishedAt);
  if (Number.isNaN(parsed.getTime())) return "";
  const local = marketParts(parsed, symbol);
  if (!isTradingDay(local.date, symbol)) return nextTradingDay(local.date, symbol);
  const closeHour = symbol.endsWith(".KS") ? 15 : 16;
  return local.hour >= closeHour ? nextTradingDay(addDays(local.date, 1), symbol) : local.date;
}

export function latestCompletedTradingDay(now = new Date(), symbol = "") {
  const local = marketParts(now, symbol);
  if (isTradingDay(local.date, symbol) && local.hour >= 17) return local.date;
  return previousTradingDay(addDays(local.date, -1), symbol);
}

export function marketImpactNeedsRefresh(row: Row, now = new Date()) {
  const impacts = asList(row.market_impact) as MarketImpact[];
  const candidates = impacts.length ? impacts : impactSymbols(row).map((symbol) => ({ symbol }));
  return candidates.some((impact) => {
    const expected = expectedReactionDate(row.published_at, impact.symbol);
    const due = expected && expected <= latestCompletedTradingDay(now, impact.symbol);
    return Boolean(due && (impact.pending || impact.error || impact.reaction_pct == null));
  });
}

export function calculateMarketImpact(symbol: string, publishedAt: unknown, bars: PriceBar[]): MarketImpact {
  const expected = expectedReactionDate(publishedAt, symbol);
  const reactionIndex = bars.findIndex((bar) => bar.date >= expected);
  const previous = reactionIndex > 0 ? bars[reactionIndex - 1] : undefined;
  const reaction = reactionIndex >= 0 ? bars[reactionIndex] : undefined;
  if (!previous) return { symbol, error: "missing price window" };
  if (!reaction) {
    return {
      symbol,
      pending: "waiting_for_reaction_close",
      expected_reaction_date: expected,
      prev_date: previous.date,
      prev_close: round(previous.close, 4),
    };
  }
  const next = bars[reactionIndex + 1];
  const third = bars[reactionIndex + 3];
  return {
    symbol,
    prev_date: previous.date,
    reaction_trade_date: reaction.date,
    prev_close: round(previous.close, 4),
    reaction_close: round(reaction.close, 4),
    next_close: next ? round(next.close, 4) : null,
    reaction_pct: pct(previous.close, reaction.close),
    next_day_pct: next ? pct(reaction.close, next.close) : null,
    three_session_pct: third ? pct(previous.close, third.close) : null,
  };
}

async function fetchBars(symbol: string, publishedAt: unknown): Promise<PriceBar[]> {
  const event = parsePublishedAt(publishedAt);
  const start = new Date(event);
  const end = new Date(event);
  start.setUTCDate(start.getUTCDate() - 10);
  end.setUTCDate(end.getUTCDate() + 11);
  const period1 = Math.floor(start.getTime() / 1000);
  const period2 = Math.floor(end.getTime() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d&events=history`;
  const response = await fetch(url, { headers: { "user-agent": "ghost-monitor/1.0" }, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) throw new Error(`price HTTP ${response.status}`);
  const payload = await response.json() as {
    chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ close?: Array<number | null> }>; adjclose?: Array<{ adjclose?: Array<number | null> }> } }> };
  };
  const result = payload.chart?.result?.[0];
  if (!result) return [];
  const closes = result.indicators?.adjclose?.[0]?.adjclose || result.indicators?.quote?.[0]?.close || [];
  return (result.timestamp || []).flatMap((timestamp, index) => {
    const close = closes[index];
    return typeof close === "number" && Number.isFinite(close)
      ? [{ date: new Date(timestamp * 1000).toISOString().slice(0, 10), close }]
      : [];
  });
}

function impactSymbols(row: Row) {
  const direct = asList(row.symbols).map(String);
  const directions = row.ticker_directions && typeof row.ticker_directions === "object"
    ? Object.keys(row.ticker_directions as Record<string, unknown>) : [];
  return [...new Set([...direct, ...directions])].filter(Boolean).slice(0, 8);
}

export async function enrichMarketImpact(row: Row, now = new Date()) {
  if (!marketImpactNeedsRefresh(row, now)) return false;
  const symbols = impactSymbols(row);
  if (!symbols.length) return false;
  row.market_impact = await Promise.all(symbols.map(async (symbol) => {
    try {
      return calculateMarketImpact(symbol, row.published_at, await fetchBars(symbol, row.published_at));
    } catch (error) {
      return { symbol, error: error instanceof Error ? error.message : "price fetch failed" };
    }
  }));
  return true;
}
