import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { alerts } from "../../../db/schema";
import { normalizeArticle } from "../../lib/ghost";

const TOOL = "alphavantage.news_sentiment.query.v1.467a92c0";

export async function POST() {
  const key = (env as unknown as { QVERIS_API_KEY?: string }).QVERIS_API_KEY;
  if (!key) return Response.json({ error: "QVERIS_API_KEY is not configured" }, { status: 503 });
  try {
    const response = await fetch("https://qveris.ai/api/v1/tools/execute", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ tool_id: TOOL, parameters: { function: "NEWS_SENTIMENT", topics: "technology", sort: "LATEST", limit: "50" } }) });
    if (!response.ok) throw new Error(`QVeris HTTP ${response.status}`);
    const payload = await response.json() as any;
    let content = payload.result?.data || payload.result?.content || {};
    if (!content.feed && payload.result?.full_content_file_url) content = await (await fetch(payload.result.full_content_file_url)).json();
    const rows = (content.feed || []).map(normalizeArticle).filter((x: any) => x.ghost_type !== "ordinary_ai_news" && x.alert_level !== "log");
    const db = getDb();
    if (rows.length) await db.insert(alerts).values(rows.map((row: any) => ({ key: row.url || row.title, payload: JSON.stringify(row), publishedAt: row.published_at || "" }))).onConflictDoNothing();
    return Response.json({ fetched: content.feed?.length || 0, captured: rows.length, stored: rows.length, mode: "global", errors: [], ts: new Date().toISOString() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "capture failed" }, { status: 500 });
  }
}
