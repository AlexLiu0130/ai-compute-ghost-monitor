import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_BODY_BYTES = 12 * 1024 * 1024;

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
  return [...merged.values()].sort((a, b) => sortTime(b) - sortTime(a));
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
  return createServer(async (request, response) => {
    const url = new URL(request.url || "/", "http://127.0.0.1");

    if (request.method === "GET" && url.pathname === "/health") {
      try {
        const rows = await readJson(alertsFile, []);
        return reply(response, 200, {
          status: "ok",
          count: Array.isArray(rows) ? rows.length : 0,
          newest: Array.isArray(rows) && rows[0] ? rows[0].published_at || null : null,
        });
      } catch (error) {
        return reply(response, 500, { error: error instanceof Error ? error.message : "health check failed" });
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

      const existing = await readJson(alertsFile, []);
      if (!Array.isArray(existing)) throw new Error("alerts file must contain an array");
      const merged = mergeRows(existing, payload.rows);
      await atomicJson(alertsFile, merged);
      await atomicJson(stateFile, {
        idempotency_key: idempotencyKey,
        count: merged.length,
        updated_at: new Date().toISOString(),
      });
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
