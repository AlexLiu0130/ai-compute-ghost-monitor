import { createHash, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 12 * 1024 * 1024;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const LEVELS = new Set(["alert", "watch", "log"]);

export function keyOf(row) {
  return String(row?.url || `${row?.published_at || ""}:${row?.title || ""}`);
}

function sortTime(row) {
  const raw = String(row?.published_at || "").replace("Z", "+00:00");
  const normalized = /^\d{8}T/.test(raw)
    ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11) || "00"}:${raw.slice(11, 13) || "00"}:${raw.slice(13, 15) || "00"}+00:00`
    : raw;
  const value = Date.parse(normalized);
  return Number.isFinite(value) ? value : 0;
}

export function mergeRows(existing, incoming) {
  const merged = new Map();
  for (const row of [...existing, ...incoming]) {
    if (!row || typeof row !== "object" || Array.isArray(row)) continue;
    const key = keyOf(row);
    if (key) merged.set(key, row);
  }
  return [...merged.values()].sort((a, b) => sortTime(b) - sortTime(a) || keyOf(b).localeCompare(keyOf(a)));
}

function shouldShow(row) {
  return row?.ghost_type !== "ordinary_ai_news" || Number(row?.ghost_score || 0) >= 20;
}

function encodeCursor(row) {
  return encodeURIComponent(JSON.stringify([sortTime(row), keyOf(row)]));
}

function decodeCursor(value) {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value));
    return Array.isArray(parsed) && parsed.length === 2 &&
      Number.isFinite(Number(parsed[0])) && typeof parsed[1] === "string"
      ? { time: Number(parsed[0]), key: parsed[1] }
      : null;
  } catch {
    return null;
  }
}

export function buildSnapshot(rows, state = {}) {
  const visible = rows.filter(shouldShow);
  const byLevel = { alert: [], watch: [], log: [] };
  for (const row of visible) {
    if (LEVELS.has(row.alert_level)) byLevel[row.alert_level].push(row);
  }
  const revision = String(state.updated_at || `${visible[0]?.published_at || ""}:${visible.length}`);
  return {
    rows,
    visible,
    byLevel,
    revision,
    counts: {
      alert: byLevel.alert.length,
      watch: byLevel.watch.length,
      log: byLevel.log.length,
    },
  };
}

export function paginateSnapshot(snapshot, { level = null, cursor = null, limit = DEFAULT_LIMIT } = {}) {
  const source = level && LEVELS.has(level) ? snapshot.byLevel[level] : snapshot.visible;
  let start = 0;
  if (cursor) {
    let end = source.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      const row = source[middle];
      const time = sortTime(row);
      if (time < cursor.time || (time === cursor.time && keyOf(row) < cursor.key)) end = middle;
      else start = middle + 1;
    }
  }
  const rows = source.slice(start, start + limit);
  return {
    version: 1,
    revision: snapshot.revision,
    total: snapshot.visible.length,
    counts: snapshot.counts,
    rows,
    next_cursor: start + rows.length < source.length && rows.length ? encodeCursor(rows.at(-1)) : null,
  };
}

function equalSecret(actual, expected) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o640 });
  await rename(temporary, path);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function reply(response, status, value) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(`${JSON.stringify(value)}\n`);
}

function publicReply(request, response, value, cacheKey) {
  const etag = `"${createHash("sha256").update(cacheKey).digest("base64url")}"`;
  if (request.headers["if-none-match"] === etag) {
    response.writeHead(304, { etag, "cache-control": "public, max-age=30, stale-while-revalidate=300" });
    return response.end();
  }
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "public, max-age=30, stale-while-revalidate=300",
    etag,
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function log(event, fields = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

export function createSyncServer({
  token = process.env.CN_SYNC_TOKEN,
  alertsFile = process.env.ALERTS_FILE,
  stateFile = process.env.SYNC_STATE_FILE || `${alertsFile}.sync-state.json`,
} = {}) {
  if (!token) throw new Error("CN_SYNC_TOKEN is required");
  if (!alertsFile) throw new Error("ALERTS_FILE is required");

  let writes = Promise.resolve();
  let snapshotPromise;
  const loadSnapshot = () => {
    snapshotPromise ||= Promise.all([
      readJson(alertsFile, []),
      readJson(stateFile, {}),
    ]).then(([rows, state]) => {
      if (!Array.isArray(rows)) throw new Error("alerts file must contain an array");
      return buildSnapshot(mergeRows([], rows), state);
    });
    return snapshotPromise;
  };

  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const snapshot = await loadSnapshot();
        return reply(response, 200, {
          status: "ok",
          count: snapshot.rows.length,
          newest: snapshot.rows[0]?.published_at || null,
          revision: snapshot.revision,
        });
      } catch (error) {
        return reply(response, 500, { error: error instanceof Error ? error.message : "health check failed" });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/alerts") {
      try {
        const snapshot = await loadSnapshot();
        const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "", 10) || DEFAULT_LIMIT));
        const requestedLevel = url.searchParams.get("level");
        const level = requestedLevel && LEVELS.has(requestedLevel) ? requestedLevel : null;
        const cursor = decodeCursor(url.searchParams.get("cursor"));
        const page = paginateSnapshot(snapshot, { level, cursor, limit });
        return publicReply(request, response, page, `${snapshot.revision}:${level || "all"}:${cursor?.time || ""}:${cursor?.key || ""}:${limit}`);
      } catch (error) {
        return reply(response, 500, { error: error instanceof Error ? error.message : "read failed" });
      }
    }

    if (request.method !== "POST" || url.pathname !== "/internal/sync/alerts") {
      return reply(response, 404, { error: "not found" });
    }

    const authorization = request.headers.authorization || "";
    if (!authorization.startsWith("Bearer ") || !equalSecret(authorization.slice(7), token)) {
      return reply(response, 401, { error: "unauthorized" });
    }

    const idempotencyKey = request.headers["x-idempotency-key"];
    if (typeof idempotencyKey !== "string" || !/^[a-f0-9]{64}$/.test(idempotencyKey)) {
      return reply(response, 400, { error: "invalid idempotency key" });
    }

    const run = async () => {
      const state = await readJson(stateFile, {});
      if (state.idempotency_key === idempotencyKey) {
        return { status: "already_applied", count: state.count || 0 };
      }

      const payload = await bodyJson(request);
      if (payload?.version !== 1 || !Array.isArray(payload.rows) || payload.rows.length > 5000) {
        const error = new Error("invalid sync payload");
        error.status = 400;
        throw error;
      }

      const current = await loadSnapshot();
      const merged = mergeRows(current.rows, payload.rows);
      const nextState = {
        idempotency_key: idempotencyKey,
        count: merged.length,
        updated_at: new Date().toISOString(),
      };
      await atomicJson(alertsFile, merged);
      await atomicJson(stateFile, nextState);
      snapshotPromise = Promise.resolve(buildSnapshot(merged, nextState));
      log("sync_applied", { received: payload.rows.length, count: merged.length });
      return { status: "applied", received: payload.rows.length, count: merged.length };
    };

    try {
      const pending = writes.then(run, run);
      writes = pending.then(() => undefined, () => undefined);
      reply(response, 200, await pending);
    } catch (error) {
      const status = Number(error?.status) || 500;
      log("sync_failed", { status, error: error instanceof Error ? error.message : "sync failed" });
      reply(response, status, { error: error instanceof Error ? error.message : "sync failed" });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT || 8788);
  createSyncServer().listen(port, "127.0.0.1", () => log("server_started", { port }));
}
