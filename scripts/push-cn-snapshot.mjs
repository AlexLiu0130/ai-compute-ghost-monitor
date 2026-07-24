import { createHash } from "node:crypto";

const source = process.env.CN_SYNC_SOURCE || "https://ghost.alexai-lab.com/api/alerts";
const target = process.env.CN_SYNC_URL;
const token = process.env.CN_SYNC_TOKEN;

if (!target || !token) throw new Error("CN_SYNC_URL and CN_SYNC_TOKEN are required");

const sourceResponse = await fetch(source);
if (!sourceResponse.ok) throw new Error(`source HTTP ${sourceResponse.status}`);
const rows = await sourceResponse.json();
if (!Array.isArray(rows)) throw new Error("source response must be an array");

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
console.log(await response.text());
