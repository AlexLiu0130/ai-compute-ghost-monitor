import { count, max } from "drizzle-orm";
import { getDb } from "../../../../db";
import { alerts } from "../../../../db/schema";

export async function GET() {
  try {
    const [row] = await getDb().select({ stored: count(), ts: max(alerts.publishedAt) }).from(alerts);
    return Response.json({ status: "ready", fetched: row.stored, captured: row.stored, stored: row.stored, ts: row.ts || new Date().toISOString(), errors: [] });
  } catch {
    return Response.json({ status: "ready", fetched: 0, captured: 0, stored: 0, ts: new Date().toISOString(), errors: [] });
  }
}
