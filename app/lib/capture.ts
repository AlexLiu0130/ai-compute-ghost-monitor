import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { alerts } from "../../db/schema";
import { normalizeArticle } from "./ghost";

const TOOL = "alphavantage.news_sentiment.query.v1.467a92c0";
const TOPICS = ["technology", "financial_markets"];
const TICKERS = "NVDA,AMD,AVGO,MRVL,INTC,QCOM,ANET,SMH,SOXX,QQQ,XLK,TSM,ASML,AMAT,LRCX,KLAC,SNPS,CDNS,META,MSFT,GOOGL,AMZN,ORCL,MU,WDC,SNDK,STX,SMCI,DELL,HPE,VRT,ETN,APH,GLW,CRWV,NBIS";
const WRITE_BATCH = 1;

type CaptureEnv = {
  DB?: D1Database;
  QVERIS_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
};

function keyOf(row: any) {
  return row.url || `${row.published_at || ""}:${row.title}`;
}

function needsTranslation(row: any) {
  const text = `${row.title_zh || ""} ${row.summary_zh || ""}`;
  return !row.title_zh || !row.summary_zh || text.includes("尚未完成中文翻译") || text.includes("ordinary ai news 信号");
}

async function translateRows(rows: any[], key?: string) {
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
      const payload = await response.json() as any;
      const data = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
      for (const item of data.items || []) {
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
  const payload = await response.json() as any;
  let content = payload.result?.data || payload.result?.content || {};
  if (!content.feed && payload.result?.full_content_file_url) {
    content = await (await fetch(payload.result.full_content_file_url)).json();
  }
  return content.feed || [];
}

export async function runCapture(env: CaptureEnv) {
  if (!env.QVERIS_API_KEY) throw new Error("QVERIS_API_KEY is not configured");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  const raw = [];
  const errors = [];
  for (const topic of TOPICS) {
    try {
      raw.push(...await fetchFeed(env, { function: "NEWS_SENTIMENT", topics: topic, sort: "LATEST", limit: "1000" }));
    } catch (error) {
      errors.push(`topic:${topic}:${error instanceof Error ? error.message : "failed"}`);
    }
  }
  try {
    raw.push(...await fetchFeed(env, { function: "NEWS_SENTIMENT", tickers: TICKERS, sort: "LATEST", limit: "1000" }));
  } catch (error) {
    errors.push(`tickers:${error instanceof Error ? error.message : "failed"}`);
  }
  if (!raw.length && errors.length) throw new Error(errors.join("; "));

  const seen = new Set<string>();
  const rows = await translateRows(raw.map(normalizeArticle).filter((row: any) => {
    const key = keyOf(row);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    if (row.ghost_type !== "ordinary_ai_news") return row.symbols?.length || row.ghost_score >= 20;
    return row.ghost_score >= 20 && row.symbols?.some((symbol: string) => TICKERS.split(",").includes(symbol));
  }), env.DEEPSEEK_API_KEY);

  if (rows.length) {
    const db = drizzle(env.DB);
    const values = rows.map((row: any) => ({
      key: keyOf(row),
      payload: JSON.stringify(row),
      publishedAt: row.published_at || "",
    }));
    for (let i = 0; i < values.length; i += WRITE_BATCH) {
      await db.insert(alerts).values(values.slice(i, i + WRITE_BATCH)).onConflictDoUpdate({
        target: alerts.key,
        set: { payload: sql`excluded.payload`, publishedAt: sql`excluded.published_at` },
      });
    }
  }

  const result = {
    fetched: raw.length,
    captured: rows.length,
    stored: rows.length,
    mode: "global",
    errors,
    ts: new Date().toISOString(),
  };

  await env.DB.prepare(`
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
