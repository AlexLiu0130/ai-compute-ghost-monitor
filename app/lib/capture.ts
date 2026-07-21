import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alerts } from "../../db/schema";
import historySource from "../data/history-source.json";
import seed from "../data/seed-alerts.json";
import { reviewEvent } from "./agent-harness";
import { normalizeArticle } from "./ghost";
import { recoverTruncatedFeed } from "./qveris-result";
import { scoreEvent, shouldCritique } from "./scoring";

const TOOL = "alphavantage.news_sentiment.query.v1.467a92c0";
const TOPICS = ["technology", "financial_markets"];
const TICKERS = "NVDA,AMD,AVGO,MRVL,INTC,QCOM,ANET,SMH,SOXX,QQQ,XLK,TSM,ASML,AMAT,LRCX,KLAC,SNPS,CDNS,META,MSFT,GOOGL,AMZN,ORCL,MU,WDC,SNDK,STX,SMCI,DELL,HPE,VRT,ETN,APH,GLW,CRWV,NBIS";
const TICKER_BATCH_SIZE = 10;
const WRITE_BATCH = 1;
const AGENT_CANDIDATE_LIMIT = 24;
const AGENT_CONCURRENCY = 6;
const LEGACY_REVIEW_LIMIT = 2;

type CaptureEnv = {
  DB?: D1Database;
  QVERIS_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
};
type Row = Record<string, unknown>;
const list = (value: unknown) => Array.isArray(value) ? value : [];

async function ensureCaptureStatus(db: D1Database) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS capture_status (
      id INTEGER PRIMARY KEY,
      fetched INTEGER NOT NULL DEFAULT 0,
      captured INTEGER NOT NULL DEFAULT 0,
      stored INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ready',
      errors TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL DEFAULT ''
    )
  `).run();
}

export async function recordCaptureFailure(env: CaptureEnv, error: unknown) {
  if (!env.DB) return;
  await ensureCaptureStatus(env.DB);
  const message = error instanceof Error ? error.message.slice(0, 300) : "capture failed";
  await env.DB.prepare(`
    INSERT INTO capture_status (id, status, errors, updated_at) VALUES (1, 'error', ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'error', errors = excluded.errors, updated_at = excluded.updated_at
  `).bind(JSON.stringify([message]), new Date().toISOString()).run();
}

function keyOf(row: Row) {
  return String(row.url || `${row.published_at || ""}:${row.title || ""}`);
}

function needsTranslation(row: Row) {
  const text = `${row.title_zh || ""} ${row.summary_zh || ""}`;
  return !row.title_zh || !row.summary_zh || text.includes("尚未完成中文翻译") || text.includes("ordinary ai news 信号");
}

function needsSemanticReview(row: Row) {
  const text = `${row.title || ""} ${row.summary || ""}`.toLowerCase();
  return list(row.symbols).length > 0 || /\b(ai|chip|gpu|hbm|compute|semiconductor|memory|data center)\b/.test(text);
}

async function judgeRows(rows: Row[], key?: string) {
  const pending = rows.filter(needsSemanticReview).slice(0, AGENT_CANDIDATE_LIMIT);
  const selected = new Set(pending);
  for (let offset = 0; offset < pending.length; offset += AGENT_CONCURRENCY) {
    await Promise.all(pending.slice(offset, offset + AGENT_CONCURRENCY).map((row) => reviewEvent(row, key, scoreEvent, shouldCritique, true)));
  }
  for (const row of rows) if (!selected.has(row)) await reviewEvent(row, key, scoreEvent, shouldCritique, false);
  return rows;
}

function uniqueRows(rows: Row[]) {
  const seen = new Set<string>();
  return rows.filter((row) => { const key = keyOf(row); if (!key || seen.has(key)) return false; seen.add(key); return true; });
}

async function existingKeys(db: D1Database, rows: Row[]) {
  const found = new Set<string>();
  for (let offset = 0; offset < rows.length; offset += 80) {
    const keys = rows.slice(offset, offset + 80).map(keyOf).filter(Boolean);
    if (!keys.length) continue;
    const query = `SELECT key FROM alerts WHERE key IN (${keys.map(() => "?").join(",")})`;
    const result = await db.prepare(query).bind(...keys).all<{ key: string }>();
    for (const item of result.results || []) found.add(item.key);
  }
  return found;
}

async function legacyStoredRows(db: D1Database, limit: number) {
  const result = await db.prepare("SELECT payload FROM alerts ORDER BY published_at DESC LIMIT 200").all<{ payload: string }>();
  const rows: Row[] = [];
  for (const item of result.results || []) {
    try {
      const row = JSON.parse(item.payload) as Row;
      if (row.scoring_version !== "anchored-v3") rows.push(row);
    } catch {
      // Ignore malformed legacy rows; /api/alerts already treats the database as fallible.
    }
    if (rows.length >= limit) break;
  }
  return rows;
}

async function translateRows(rows: Row[], key?: string) {
  if (!key) return rows;
  const pending = rows.filter(needsTranslation);
  for (let offset = 0; offset < pending.length; offset += 30) {
    const batch = pending.slice(offset, offset + 30);
    try {
      const response = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "deepseek-chat",
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [{
            role: "user",
            content: `Translate these finance news items into natural, concise Simplified Chinese. Return strict JSON {"items":[{"i":0,"title_zh":"...","summary_zh":"..."}]}. Keep tickers and company names unchanged. Do not output placeholders.\n${JSON.stringify(batch.map((r, i) => ({ i, title: r.title, summary: r.summary })))}`
          }],
        }),
      });
      if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const data = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
      for (const item of (data.items || []) as Array<{ i: number; title_zh?: string; summary_zh?: string }>) {
        const row = batch[item.i];
        if (row && item.title_zh && item.summary_zh) Object.assign(row, { title_zh: item.title_zh, summary_zh: item.summary_zh });
      }
    } catch {
      // Keep raw English fields; the UI hides them in Chinese mode instead of showing fake translations.
    }
  }
  return rows;
}

async function fetchFeed(env: CaptureEnv, parameters: Record<string, string>) {
  const response = await fetch("https://qveris.ai/api/v1/tools/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.QVERIS_API_KEY}`,
    },
    body: JSON.stringify({ tool_id: TOOL, parameters }),
  });
  if (!response.ok) throw new Error(`QVeris HTTP ${response.status}`);
  const payload = await response.json() as { result?: { data?: { feed?: unknown[]; Information?: string }; content?: { feed?: unknown[] }; full_content_file_url?: string; truncated_content?: string } };
  let content = payload.result?.data || payload.result?.content || {};
  const providerInformation = "Information" in content ? content.Information : undefined;
  if (typeof providerInformation === "string" && providerInformation) throw new Error(providerInformation.slice(0, 160));
  if (!content.feed && payload.result?.full_content_file_url) {
    try {
      const full = await fetch(payload.result.full_content_file_url, { signal: AbortSignal.timeout(10_000) });
      if (!full.ok) throw new Error(`full result HTTP ${full.status}`);
      content = await full.json() as { feed?: unknown[] };
    } catch {
      const recovered = recoverTruncatedFeed(payload.result.truncated_content);
      if (recovered.length) return recovered;
    }
  }
  const feed = list(content.feed);
  if (feed.length) return feed;
  const recovered = recoverTruncatedFeed(payload.result?.truncated_content);
  if (recovered.length) return recovered;
  throw new Error("QVeris returned no readable feed");
}

async function storeRows(binding: D1Database, rows: Row[]) {
  if (!rows.length) return;
  const db = drizzle(binding);
  const values = rows.map((row) => ({
    key: keyOf(row),
    payload: JSON.stringify(row),
    publishedAt: String(row.published_at || ""),
  }));
  for (let index = 0; index < values.length; index += WRITE_BATCH) {
    await db.insert(alerts).values(values.slice(index, index + WRITE_BATCH)).onConflictDoUpdate({
      target: alerts.key,
      set: { payload: sql`excluded.payload`, publishedAt: sql`excluded.published_at` },
    });
  }
}

export async function runHistoryBatch(env: CaptureEnv, limit = 12) {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS history_reprocess (
    key TEXT PRIMARY KEY, processed_at TEXT NOT NULL, score INTEGER NOT NULL, status TEXT NOT NULL
  )`).run();
  const done = await env.DB.prepare("SELECT key FROM history_reprocess").all<{ key: string }>();
  const processed = new Set((done.results || []).map((row) => row.key));
  const pending = uniqueRows(historySource as Row[]).filter((row) => !processed.has(keyOf(row)));
  const batch = pending.slice(0, Math.max(1, Math.min(limit, 24))).map((row) => scoreEvent({ ...row }));
  const reviewed = await judgeRows(batch, env.DEEPSEEK_API_KEY);
  const translated = await translateRows(reviewed, env.DEEPSEEK_API_KEY);
  await storeRows(env.DB, translated);
  const now = new Date().toISOString();
  for (const row of translated) {
    await env.DB.prepare(`INSERT INTO history_reprocess (key, processed_at, score, status) VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET processed_at = excluded.processed_at, score = excluded.score, status = excluded.status`)
      .bind(keyOf(row), now, Number(row.ghost_score || 0), String(row.analysis_method || "unknown")).run();
  }
  const aggregate = await env.DB.prepare(`SELECT
    COUNT(*) AS processed,
    SUM(CASE WHEN score >= 65 THEN 1 ELSE 0 END) AS alert,
    SUM(CASE WHEN score >= 35 AND score < 65 THEN 1 ELSE 0 END) AS watch,
    SUM(CASE WHEN score < 35 THEN 1 ELSE 0 END) AS log
    FROM history_reprocess`).first<{ processed: number; alert: number; watch: number; log: number }>();
  const methods = await env.DB.prepare("SELECT status, COUNT(*) AS count FROM history_reprocess GROUP BY status")
    .all<{ status: string; count: number }>();
  return {
    processed: translated.length,
    remaining: Math.max(0, pending.length - translated.length),
    total: (historySource as Row[]).length,
    alert: translated.filter((row) => row.alert_level === "alert").length,
    watch: translated.filter((row) => row.alert_level === "watch").length,
    fallback: translated.filter((row) => row.analysis_method === "rules_fallback").length,
    aggregate,
    methods: Object.fromEntries((methods.results || []).map((row) => [row.status, row.count])),
    ts: now,
  };
}

export async function runCapture(env: CaptureEnv) {
  if (!env.QVERIS_API_KEY) throw new Error("QVERIS_API_KEY is not configured");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  await ensureCaptureStatus(env.DB);
  await env.DB.prepare(`
    INSERT INTO capture_status (id, status, errors, updated_at) VALUES (1, 'running', '[]', ?)
    ON CONFLICT(id) DO UPDATE SET status = 'running', errors = '[]', updated_at = excluded.updated_at
  `).bind(new Date().toISOString()).run();

  const raw = [];
  const errors = [];
  for (const topic of TOPICS) {
    try {
      raw.push(...await fetchFeed(env, { function: "NEWS_SENTIMENT", topics: topic, sort: "LATEST", limit: "1000" }));
    } catch (error) {
      errors.push(`topic:${topic}:${error instanceof Error ? error.message : "failed"}`);
    }
  }
  const tickerList = TICKERS.split(",");
  for (let offset = 0; offset < tickerList.length; offset += TICKER_BATCH_SIZE) {
    const batch = tickerList.slice(offset, offset + TICKER_BATCH_SIZE);
    try {
      raw.push(...await fetchFeed(env, { function: "NEWS_SENTIMENT", tickers: batch.join(","), sort: "LATEST", limit: "1000" }));
    } catch (error) {
      if (batch.length <= 5) {
        errors.push(`tickers:${batch.join(",")}:${error instanceof Error ? error.message : "failed"}`);
        continue;
      }
      for (let split = 0; split < batch.length; split += 5) {
        const fallback = batch.slice(split, split + 5);
        try {
          raw.push(...await fetchFeed(env, { function: "NEWS_SENTIMENT", tickers: fallback.join(","), sort: "LATEST", limit: "1000" }));
        } catch (fallbackError) {
          errors.push(`tickers:${fallback.join(",")}:${fallbackError instanceof Error ? fallbackError.message : "failed"}`);
        }
      }
    }
  }
  if (!raw.length && errors.length) throw new Error(errors.join("; "));

  const normalized = uniqueRows(raw.map(normalizeArticle));
  const storedKeys = await existingKeys(env.DB, normalized);
  const judged = await judgeRows(normalized.filter((row) => !storedKeys.has(keyOf(row))), env.DEEPSEEK_API_KEY);
  const rows = await translateRows(judged.filter((row: Row) => {
    return Number(row.ghost_score || 0) >= 20 && list(row.symbols).some((symbol) => TICKERS.split(",").includes(String(symbol)));
  }), env.DEEPSEEK_API_KEY);

  // Migrate a small, bounded slice of legacy seed records on every scheduled run.
  // D1 rows override matching seeds in /api/alerts, so the migration is resumable.
  const storedLegacy = env.DEEPSEEK_API_KEY ? await legacyStoredRows(env.DB, LEGACY_REVIEW_LIMIT) : [];
  const seedKeys = env.DEEPSEEK_API_KEY && storedLegacy.length < LEGACY_REVIEW_LIMIT
    ? await existingKeys(env.DB, seed as Row[]) : new Set<string>();
  const seedLegacy = (seed as Row[])
    .filter((row) => row.scoring_version !== "anchored-v3" && !seedKeys.has(keyOf(row)))
    .slice(0, LEGACY_REVIEW_LIMIT - storedLegacy.length);
  const legacy = env.DEEPSEEK_API_KEY
    ? [...storedLegacy, ...seedLegacy].map((row) => scoreEvent(row)) : [];
  const reviewedLegacy = await judgeRows(legacy, env.DEEPSEEK_API_KEY);
  const migrated = await translateRows(reviewedLegacy, env.DEEPSEEK_API_KEY);
  const writeRows = [...rows, ...migrated];

  await storeRows(env.DB, writeRows);

  const result = {
    fetched: raw.length,
    captured: rows.length,
    stored: writeRows.length,
    migrated: migrated.length,
    mode: "global",
    errors,
    ts: new Date().toISOString(),
  };

  await env.DB.prepare(`
    INSERT INTO capture_status (id, fetched, captured, stored, status, errors, updated_at)
    VALUES (1, ?, ?, ?, 'ready', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      fetched = excluded.fetched,
      captured = excluded.captured,
      stored = excluded.stored,
      status = excluded.status,
      errors = excluded.errors,
      updated_at = excluded.updated_at
  `).bind(result.fetched, result.captured, result.stored, JSON.stringify(errors), result.ts).run();

  return result;
}
