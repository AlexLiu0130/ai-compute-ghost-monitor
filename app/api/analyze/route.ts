import { env } from "cloudflare:workers";
import { reviewEvent } from "../../lib/agent-harness";
import { scoreEvent, shouldCritique } from "../../lib/scoring";

async function withinRateLimit(db: D1Database, key: string, limit: number) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS api_rate_limits (
    key TEXT PRIMARY KEY, count INTEGER NOT NULL, window_start INTEGER NOT NULL
  )`).run();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare(`INSERT INTO api_rate_limits (key, count, window_start) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET
      count = CASE WHEN ? - window_start >= 3600 THEN 1 ELSE count + 1 END,
      window_start = CASE WHEN ? - window_start >= 3600 THEN ? ELSE window_start END`)
    .bind(key, now, now, now, now).run();
  const row = await db.prepare("SELECT count FROM api_rate_limits WHERE key = ?").bind(key).first<{ count: number }>();
  return Number(row?.count || 0) <= limit;
}

export async function POST(request: Request) {
  try {
    if (Number(request.headers.get("content-length") || 0) > 20_000) {
      return Response.json({ error: "payload too large" }, { status: 413 });
    }
    const input = await request.json() as Record<string, unknown>;
    const payload = {
      title: String(input.title || "").slice(0, 2_000),
      summary: String(input.summary || "").slice(0, 6_000),
      source: String(input.source || "").slice(0, 300),
      symbols: Array.isArray(input.symbols) ? input.symbols.slice(0, 40).map(String) : [],
    };
    if (!String(payload.title || "").trim()) return Response.json({ error: "title is required" }, { status: 400 });
    const binding = (env as unknown as { DB?: D1Database }).DB;
    if (!binding) return Response.json({ error: "analysis unavailable" }, { status: 503 });
    const ip = request.headers.get("cf-connecting-ip") || "unknown";
    const [ipAllowed, globalAllowed] = await Promise.all([
      withinRateLimit(binding, `analyze:ip:${ip}`, 5),
      withinRateLimit(binding, "analyze:global", 60),
    ]);
    if (!ipAllowed || !globalAllowed) return Response.json({ error: "rate limit exceeded" }, { status: 429 });
    const row = scoreEvent(payload);
    const key = (env as unknown as { DEEPSEEK_API_KEY?: string }).DEEPSEEK_API_KEY;
    return Response.json(await reviewEvent(row, key, scoreEvent, shouldCritique, true));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}
