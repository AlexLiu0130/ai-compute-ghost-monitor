import { createHash } from "node:crypto";

const source = process.env.CN_SYNC_SOURCE || "https://ghost.alexai-lab.com/api/alerts";
const target = process.env.CN_SYNC_URL;
const token = process.env.CN_SYNC_TOKEN;

if (!target || !token) throw new Error("CN_SYNC_URL and CN_SYNC_TOKEN are required");

async function push(rows) {
  const body = JSON.stringify({ version: 1, rows });
  const idempotencyKey = createHash("sha256").update(body).digest("hex");
  const response = await fetch(target, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "x-idempotency-key": idempotencyKey,
    },
    body,
  });
  if (!response.ok) throw new Error(`sync HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

let cursor = null;
let total = 0;
let batches = 0;
const seen = new Set();

do {
  const url = new URL(source);
  url.searchParams.set("limit", "100");
  if (cursor) url.searchParams.set("cursor", cursor);
  const sourceResponse = await fetch(url);
  if (!sourceResponse.ok) throw new Error(`source HTTP ${sourceResponse.status}`);
  const payload = await sourceResponse.json();
  const rows = Array.isArray(payload) ? payload : payload.rows;
  if (!Array.isArray(rows)) throw new Error("source response must contain rows");
  if (rows.length) {
    await push(rows);
    total += rows.length;
    batches += 1;
  }
  const next = Array.isArray(payload) ? null : payload.next_cursor || null;
  if (next && seen.has(next)) throw new Error("source returned a repeated cursor");
  if (next) seen.add(next);
  cursor = next;
} while (cursor);

console.log(JSON.stringify({ status: "synced", rows: total, batches }));
