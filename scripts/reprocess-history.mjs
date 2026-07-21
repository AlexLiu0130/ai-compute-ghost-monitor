import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { reviewEvent } from "../app/lib/agent-harness.ts";
import { AGENT_PROMPT_VERSION } from "../app/lib/agent-prompts.ts";
import { scoreEvent, shouldCritique } from "../app/lib/scoring.ts";

const root = resolve(import.meta.dirname, "..");
const project = resolve(root, "../project");
const start = process.argv[2] || "2025-01-01";
const limit = Number(process.argv[3] || 0);
const concurrency = Math.max(1, Number(process.argv[4] || 6));
const work = resolve(root, "work");
const cachePath = resolve(work, "history-v3-cache.json");

async function json(path, fallback) {
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return fallback; }
}

async function loadEnv(path) {
  const text = await readFile(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [name, ...rest] = line.split("=");
    process.env[name.trim()] ??= rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}

function dateOf(row) {
  const value = String(row.published_at || row.date || "");
  return /^\d{8}/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : value.slice(0, 10);
}

function keyOf(row) {
  return createHash("sha1").update(JSON.stringify({
    url: row.url || "", title: row.title || "", summary: row.summary || "",
    version: AGENT_PROMPT_VERSION,
  })).digest("hex");
}

function translationKey(row) {
  return createHash("sha1").update(`${row.title || ""}\n${row.summary || ""}`).digest("hex");
}

async function save(path, value) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2));
  await rename(temporary, path);
}

await mkdir(work, { recursive: true });
await loadEnv(resolve(project, ".env"));
const apiKey = process.env.DEEPSEEK_API_KEY || process.env.OPENAI_API_KEY;
if (!apiKey) throw new Error("DeepSeek API key is unavailable");

const source = await json(resolve(project, "data/backfill_articles.json"), []);
const translations = await json(resolve(project, "data/translation_cache.json"), {});
const impactRows = await json(resolve(project, "reports/backfill_market_impact.json"), []);
const impactByUrl = new Map(impactRows.flatMap((row) => (row.evidence_urls || []).map((url) => [url, row.market_impact || []])));
const deduped = new Map();
for (const row of source) {
  if (dateOf(row) < start) continue;
  const key = row.url || `${row.published_at || ""}:${row.title || ""}`;
  if (key) deduped.set(key, row);
}
const rows = [...deduped.values()].sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")));
const input = limit > 0 ? rows.slice(0, limit) : rows;
const cache = await json(cachePath, {});
let completed = 0;

for (let offset = 0; offset < input.length; offset += concurrency) {
  await Promise.all(input.slice(offset, offset + concurrency).map(async (sourceRow) => {
    const key = keyOf(sourceRow);
    if (!cache[key]) {
      const row = scoreEvent({ ...sourceRow });
      cache[key] = await reviewEvent(row, apiKey, scoreEvent, shouldCritique, true);
    }
    completed += 1;
  }));
  await save(cachePath, cache);
  if (completed % 30 === 0 || completed === input.length) process.stdout.write(`\r${completed}/${input.length}`);
}
process.stdout.write("\n");

const all = input.map((sourceRow) => {
  const row = { ...cache[keyOf(sourceRow)] };
  const translated = translations[translationKey(row)];
  if (translated?.title_zh && translated?.summary_zh) Object.assign(row, translated);
  const marketImpact = impactByUrl.get(row.url);
  if (marketImpact?.length) row.market_impact = marketImpact;
  return row;
});
const selected = all.filter((row) => row.ghost_type !== "ordinary_ai_news" && Number(row.ghost_score || 0) >= 20);
await save(resolve(work, "history-v3-all.json"), all);
await save(resolve(work, "history-v3-selected.json"), selected);
const summary = {
  start, end: new Date().toISOString(), input: input.length, selected: selected.length,
  alert: selected.filter((row) => row.alert_level === "alert").length,
  watch: selected.filter((row) => row.alert_level === "watch").length,
  log: selected.filter((row) => row.alert_level === "log").length,
  llm: all.filter((row) => row.analysis_method === "llm").length,
  llm_unreviewed: all.filter((row) => row.analysis_method === "llm_unreviewed").length,
  fallback: all.filter((row) => row.analysis_method === "rules_fallback").length,
};
await save(resolve(work, "history-v3-summary.json"), summary);
console.log(JSON.stringify(summary));
