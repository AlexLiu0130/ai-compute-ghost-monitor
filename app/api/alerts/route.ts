import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { alerts } from "../../../db/schema";
import seed from "../../data/seed-alerts.json";

export async function GET() {
  try {
    const rows = await getDb().select().from(alerts).orderBy(desc(alerts.publishedAt)).limit(100);
    return Response.json([...rows.map(r => JSON.parse(r.payload)), ...seed]);
  } catch {
    return Response.json(seed);
  }
}
