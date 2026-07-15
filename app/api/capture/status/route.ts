import { env } from "cloudflare:workers";
import { count } from "drizzle-orm";
import { getDb } from "../../../../db";
import { alerts } from "../../../../db/schema";

export async function GET() {
  try {
    const binding = (env as unknown as { DB?: D1Database }).DB;
    if (binding) {
      const row = await binding.prepare("SELECT fetched, captured, stored, status, errors, updated_at FROM capture_status WHERE id = 1").first<{
        fetched: number;
        captured: number;
        stored: number;
        status: string;
        errors: string;
        updated_at: string;
      }>();
      if (row) {
        return Response.json({
          status: row.status || "ready",
          fetched: row.fetched || 0,
          captured: row.captured || 0,
          stored: row.stored || 0,
          ts: row.updated_at || new Date().toISOString(),
          errors: JSON.parse(row.errors || "[]"),
        });
      }
    }
    const [row] = await getDb().select({ stored: count() }).from(alerts);
    return Response.json({ status: "ready", fetched: 0, captured: 0, stored: row.stored, ts: new Date().toISOString(), errors: [] });
  } catch {
    return Response.json({ status: "ready", fetched: 0, captured: 0, stored: 0, ts: new Date().toISOString(), errors: [] });
  }
}
