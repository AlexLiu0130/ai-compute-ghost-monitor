import { desc } from "drizzle-orm";
import { getDb } from "../../../db";
import { alerts } from "../../../db/schema";
import seed from "../../data/seed-alerts.json";

function sortTime(row: Record<string, unknown>) {
  const raw = String(row.published_at || "").replace("Z", "+00:00");
  const normalized = /^\d{8}T/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11) || "00"}:${raw.slice(11, 13) || "00"}:${raw.slice(13, 15) || "00"}+00:00`
    : raw;
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

function mergeAlerts(rows: Record<string, unknown>[]) {
  const seen = new Set<string>();
  const merged = [];
  for (const row of rows) {
    const clean = cleanAlert(row);
    if (!shouldShow(clean)) continue;
    const key = String(row.url || row.title || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(clean);
  }
  return merged.sort((a, b) => sortTime(b) - sortTime(a));
}

function cleanAlert(row: Record<string, unknown>) {
  const copy = { ...row };
  const zh = `${copy.title_zh || ""} ${copy.summary_zh || ""}`;
  if (zh.includes("尚未完成中文翻译") || zh.includes("ordinary ai news 信号") || zh.includes("相关 ordinary")) {
    delete copy.title_zh;
    delete copy.summary_zh;
  }
  return copy;
}

function shouldShow(row: Record<string, unknown>) {
  if (row.ghost_type !== "ordinary_ai_news") return true;
  return Number(row.ghost_score || 0) >= 20;
}

export async function GET() {
  try {
    const rows = await getDb().select().from(alerts).orderBy(desc(alerts.publishedAt)).limit(500);
    return Response.json(mergeAlerts([...seed, ...rows.map(r => JSON.parse(r.payload))]));
  } catch {
    return Response.json(seed);
  }
}
