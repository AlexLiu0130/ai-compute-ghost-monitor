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

function chineseFallback(row: any) {
  const symbols = (row.symbols || []).slice(0, 4).join("、") || "相关标的";
  const type = String(row.ghost_type || "").replace(/_/g, " ");
  return {
    ...row,
    title_zh: row.title_zh || `${symbols} 相关 ${type} 信号`,
    summary_zh: row.summary_zh || `该新闻已捕获但尚未完成中文翻译。当前先按类型、标的和影响链条纳入监控，英文原文可在详情中展开查看。`,
  };
}

async function translateRows(rows: any[], key?: string) {
  if (!key) return rows.map(chineseFallback);
  const pending = rows.filter((row) => !row.title_zh || !row.summary_zh).slice(0, 20);
  if (!pending.length) return rows.map(chineseFallback);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: `Translate these finance news items into concise Chinese. Return JSON {"items":[{"i":0,"title_zh":"...","summary_zh":"..."}]}. Keep tickers/company names unchanged.\n${JSON.stringify(pending.map((r, i) => ({ i, title: r.title, summary: r.summary })))}`
        }],
      }),
    });
    if (!response.ok) throw new Error(`DeepSeek HTTP ${response.status}`);
    const payload = await response.json() as any;
    const data = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
    for (const item of data.items || []) {
      const row = pending[item.i];
      if (row) Object.assign(row, { title_zh: item.title_zh, summary_zh: item.summary_zh });
    }
  } catch {
    // Fall back below; translation failure must not block capture.
  }
  return rows.map(chineseFallback);
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
    return row.symbols?.length && Object.keys(row.ticker_directions || {}).length;
  }), env.DEEPSEEK_API_KEY);

  if (rows.length) {
    const db = drizzle(env.DB);
    const values = rows.map((row: any) => ({
      key: keyOf(row),
      payload: JSON.stringify(row),
      publishedAt: row.published_at || "",
    }));
    for (let i = 0; i < values.length; i += WRITE_BATCH) {
      await db.insert(alerts).values(values.slice(i, i + WRITE_BATCH)).onConflictDoNothing();
    }
  }

  return {
    fetched: raw.length,
    captured: rows.length,
    stored: rows.length,
    mode: "global",
    errors,
    ts: new Date().toISOString(),
  };
}
