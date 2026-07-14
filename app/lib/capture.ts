import { drizzle } from "drizzle-orm/d1";
import { alerts } from "../../db/schema";
import { normalizeArticle } from "./ghost";

const TOOL = "alphavantage.news_sentiment.query.v1.467a92c0";

type CaptureEnv = {
  DB?: D1Database;
  QVERIS_API_KEY?: string;
};

export async function runCapture(env: CaptureEnv) {
  if (!env.QVERIS_API_KEY) throw new Error("QVERIS_API_KEY is not configured");
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  const response = await fetch("https://qveris.ai/api/v1/tools/execute", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.QVERIS_API_KEY}`,
    },
    body: JSON.stringify({
      tool_id: TOOL,
      parameters: { function: "NEWS_SENTIMENT", topics: "technology", sort: "LATEST", limit: "50" },
    }),
  });
  if (!response.ok) throw new Error(`QVeris HTTP ${response.status}`);

  const payload = await response.json() as any;
  let content = payload.result?.data || payload.result?.content || {};
  if (!content.feed && payload.result?.full_content_file_url) {
    content = await (await fetch(payload.result.full_content_file_url)).json();
  }

  const rows = (content.feed || [])
    .map(normalizeArticle)
    .filter((row: any) => row.ghost_type !== "ordinary_ai_news" && row.alert_level !== "log");

  if (rows.length) {
    await drizzle(env.DB).insert(alerts).values(rows.map((row: any) => ({
      key: row.url || row.title,
      payload: JSON.stringify(row),
      publishedAt: row.published_at || "",
    }))).onConflictDoNothing();
  }

  return {
    fetched: content.feed?.length || 0,
    captured: rows.length,
    stored: rows.length,
    mode: "global",
    errors: [],
    ts: new Date().toISOString(),
  };
}
