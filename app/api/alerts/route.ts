import { env } from "cloudflare:workers";
import seed from "../../data/seed-alerts.json";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const LEVELS = new Set(["alert", "watch", "log"]);
const JSON_VALUE = "CASE WHEN json_valid(payload) THEN payload ELSE '{}' END";
const VISIBLE_SQL = `(json_valid(payload) AND (
  COALESCE(json_extract(${JSON_VALUE}, '$.ghost_type'), '') <> 'ordinary_ai_news'
  OR CAST(COALESCE(json_extract(${JSON_VALUE}, '$.ghost_score'), 0) AS REAL) >= 20
))`;
const SORT_TIME_SQL = `CASE
  WHEN published_at GLOB '????????T*' THEN
    substr(published_at, 1, 4) || '-' || substr(published_at, 5, 2) || '-' || substr(published_at, 7, 2)
    || 'T' || substr(published_at, 10, 2) || ':' || substr(published_at, 12, 2) || ':' || substr(published_at, 14, 2)
  ELSE replace(replace(published_at, 'Z', ''), '+00:00', '')
END`;

type AlertRow = Record<string, unknown>;
type Cursor = { time: string; key: string };

function sortTime(row: AlertRow) {
  const raw = String(row.published_at || "").replace("Z", "+00:00");
  const normalized = /^\d{8}T/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11) || "00"}:${raw.slice(11, 13) || "00"}:${raw.slice(13, 15) || "00"}+00:00`
    : raw;
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

function keyOf(row: AlertRow) {
  return String(row.url || `${row.published_at || ""}:${row.title || ""}`);
}

function cleanAlert(row: AlertRow) {
  const copy = { ...row };
  delete copy.ml_predictions;
  if (!copy.scoring_version) copy.scoring_version = "legacy-v2";
  const zh = `${copy.title_zh || ""} ${copy.summary_zh || ""}`;
  if (zh.includes("尚未完成中文翻译") || zh.includes("ordinary ai news 信号") || zh.includes("相关 ordinary")) {
    delete copy.title_zh;
    delete copy.summary_zh;
  }
  return copy;
}

function shouldShow(row: AlertRow) {
  return row.ghost_type !== "ordinary_ai_news" || Number(row.ghost_score || 0) >= 20;
}

function encodeCursor(time: string, key: string) {
  return encodeURIComponent(JSON.stringify([time, key]));
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) && parsed.length === 2 && parsed.every((item) => typeof item === "string")
      ? { time: parsed[0], key: parsed[1] }
      : null;
  } catch {
    return null;
  }
}

function fallbackPage(level: string | null, cursor: Cursor | null, limit: number) {
  const all = (seed as AlertRow[])
    .map(cleanAlert)
    .filter((row) => shouldShow(row))
    .sort((a, b) => sortTime(b) - sortTime(a) || keyOf(b).localeCompare(keyOf(a)));
  const counts = { alert: 0, watch: 0, log: 0 };
  for (const row of all) {
    const alertLevel = String(row.alert_level || "");
    if (alertLevel in counts) counts[alertLevel as keyof typeof counts] += 1;
  }
  const filtered = level ? all.filter((row) => row.alert_level === level) : all;
  const cursorTime = cursor ? Date.parse(`${cursor.time}${/[zZ]|[+-]\d\d:\d\d$/.test(cursor.time) ? "" : "Z"}`) : 0;
  const start = cursor
    ? filtered.findIndex((row) => sortTime(row) < cursorTime ||
      (sortTime(row) === cursorTime && keyOf(row) < cursor.key))
    : 0;
  const safeStart = Math.max(0, start);
  const page = filtered.slice(safeStart, safeStart + limit);
  const last = page.at(-1);
  return {
    version: 1,
    revision: `${all[0]?.published_at || "seed"}:${all.length}`,
    total: all.length,
    counts,
    rows: page,
    next_cursor: safeStart + page.length < filtered.length && last
      ? encodeCursor(new Date(sortTime(last)).toISOString().replace("Z", ""), keyOf(last))
      : null,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "", 10) || DEFAULT_LIMIT));
  const requestedLevel = url.searchParams.get("level");
  const level = requestedLevel && LEVELS.has(requestedLevel) ? requestedLevel : null;
  const cursor = decodeCursor(url.searchParams.get("cursor"));

  try {
    if (!env.DB) throw new Error("D1 binding unavailable");
    const conditions = [VISIBLE_SQL];
    const bindings: unknown[] = [];
    if (level) {
      conditions.push(`json_extract(${JSON_VALUE}, '$.alert_level') = ?`);
      bindings.push(level);
    }
    if (cursor) {
      conditions.push(`(${SORT_TIME_SQL} < ? OR (${SORT_TIME_SQL} = ? AND key < ?))`);
      bindings.push(cursor.time, cursor.time, cursor.key);
    }

    const result = await env.DB.prepare(`
      SELECT key, payload, ${SORT_TIME_SQL} AS sort_time
      FROM alerts
      WHERE ${conditions.join(" AND ")}
      ORDER BY sort_time DESC, key DESC
      LIMIT ?
    `).bind(...bindings, limit + 1).all<{ key: string; payload: string; sort_time: string }>();
    const records = result.results || [];
    const pageRecords = records.slice(0, limit);
    const rows = pageRecords.flatMap((record) => {
      try {
        const parsed = JSON.parse(record.payload);
        return parsed && typeof parsed === "object" ? [cleanAlert(parsed as AlertRow)] : [];
      } catch {
        return [];
      }
    });

    const stats = await env.DB.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN json_extract(${JSON_VALUE}, '$.alert_level') = 'alert' THEN 1 ELSE 0 END) AS alerts,
        SUM(CASE WHEN json_extract(${JSON_VALUE}, '$.alert_level') = 'watch' THEN 1 ELSE 0 END) AS watches,
        SUM(CASE WHEN json_extract(${JSON_VALUE}, '$.alert_level') = 'log' THEN 1 ELSE 0 END) AS logs
      FROM alerts
      WHERE ${VISIBLE_SQL}
    `).first<{ total: number; alerts: number; watches: number; logs: number }>();
    let revision = `${pageRecords[0]?.sort_time || ""}:${stats?.total || 0}`;
    try {
      const capture = await env.DB.prepare("SELECT updated_at FROM capture_status WHERE id = 1")
        .first<{ updated_at: string }>();
      if (capture?.updated_at) revision = capture.updated_at;
    } catch {
      // Fresh databases may not have capture_status until the first scheduled run.
    }
    const last = pageRecords.at(-1);
    return Response.json({
      version: 1,
      revision,
      total: Number(stats?.total || 0),
      counts: {
        alert: Number(stats?.alerts || 0),
        watch: Number(stats?.watches || 0),
        log: Number(stats?.logs || 0),
      },
      rows,
      next_cursor: records.length > limit && last ? encodeCursor(last.sort_time, last.key) : null,
    }, {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
    });
  } catch {
    return Response.json(fallbackPage(level, cursor, limit), {
      headers: { "cache-control": "public, max-age=30, stale-while-revalidate=300" },
    });
  }
}
