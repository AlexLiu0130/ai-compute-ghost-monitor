import { readFile } from "node:fs/promises";
import { scoreEvent } from "../app/lib/scoring.ts";

const MATERIAL_ABNORMAL_RETURN_PCT = 2;
const TRAIN_FRACTION = 0.7;
const MIN_THRESHOLD = 35;
const MAX_THRESHOLD = 80;
const WATCH_THRESHOLD = 35;
const ALERT_THRESHOLD = 65;

const percent = (numerator, denominator) => denominator ? (numerator / denominator) * 100 : 0;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const dayOf = (publishedAt) => publishedAt.slice(0, 10);
const canonicalUrl = (value) => {
  if (!value) return "";
  try {
    const url = new URL(String(value));
    url.search = "";
    url.hash = "";
    return `${url.hostname.replace(/^www\./, "").toLowerCase()}${url.pathname.replace(/\/$/, "").toLowerCase()}`;
  } catch {
    return String(value).trim().toLowerCase();
  }
};
const canonicalTitle = (value) => String(value || "")
  .toLowerCase()
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .trim();

function fail(message) {
  throw new Error(`Historical evaluation failed: ${message}`);
}

function deduplicate(rows) {
  const urls = new Set();
  const titles = new Set();
  const unique = [];
  let duplicates = 0;
  for (const row of rows) {
    const url = canonicalUrl(row.url);
    const title = canonicalTitle(row.title || row.headline);
    if (!url && !title) fail("a seed record has neither url nor title for deduplication");
    if ((url && urls.has(url)) || (title && titles.has(title))) {
      duplicates += 1;
      continue;
    }
    if (url) urls.add(url);
    if (title) titles.add(title);
    unique.push(row);
  }
  return { unique, duplicates };
}

function metric(rows, threshold) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const row of rows) {
    const alerted = row.score >= threshold;
    if (alerted && row.material) tp += 1;
    else if (alerted) fp += 1;
    else if (row.material) fn += 1;
    else tn += 1;
  }
  const precision = percent(tp, tp + fp);
  const recall = percent(tp, tp + fn);
  const fpr = percent(fp, fp + tn);
  return { tp, fp, tn, fn, precision, recall, fpr, f1: percent(2 * tp, 2 * tp + fp + fn) };
}

function chooseThreshold(training) {
  const minimumAlerts = Math.min(3, Math.max(1, Math.ceil(training.length * 0.1)));
  const candidates = Array.from({ length: MAX_THRESHOLD - MIN_THRESHOLD + 1 }, (_, index) => {
    const threshold = MIN_THRESHOLD + index;
    return { threshold, ...metric(training, threshold) };
  });
  const precise = candidates.filter((candidate) => candidate.precision >= 65 && candidate.tp + candidate.fp >= minimumAlerts);
  const ranked = (precise.length ? precise : candidates).sort((a, b) => {
    if (precise.length) return b.recall - a.recall || b.precision - a.precision || a.threshold - b.threshold;
    return b.f1 - a.f1 || b.precision - a.precision || b.recall - a.recall || a.threshold - b.threshold;
  });
  return { selected: ranked[0], criterion: precise.length ? `precision>=65% with >=${minimumAlerts} alerts, then max recall` : "no supported threshold reached 65% precision; max F1" };
}

function label(row) {
  const symbols = new Set((Array.isArray(row.symbols) ? row.symbols : []).map((symbol) => String(symbol).toUpperCase()));
  const impacts = Array.isArray(row.market_impact) ? row.market_impact : [];
  const qqq = impacts.find((impact) => String(impact.symbol).toUpperCase() === "QQQ" && number(impact.reaction_pct) != null);
  const direct = impacts.filter((impact) => symbols.has(String(impact.symbol).toUpperCase()) && number(impact.reaction_pct) != null);
  if (!direct.length) return { reason: "no_direct_symbol_reaction" };
  if (!qqq) return { reason: "missing_qqq_reaction" };
  const qqqReaction = number(qqq.reaction_pct);
  const reactions = direct.map((impact) => ({
    symbol: String(impact.symbol).toUpperCase(),
    abnormalPct: number(impact.reaction_pct) - qqqReaction,
  }));
  return {
    reactions,
    material: reactions.some(({ abnormalPct }) => Math.abs(abnormalPct) >= MATERIAL_ABNORMAL_RETURN_PCT),
  };
}

function directionAccuracy(rows, threshold) {
  let correct = 0, total = 0;
  for (const row of rows) {
    if (row.score < threshold) continue;
    const directions = row.result.ticker_directions || {};
    for (const reaction of row.reactions) {
      if (Math.abs(reaction.abnormalPct) < MATERIAL_ABNORMAL_RETURN_PCT) continue;
      const direction = directions[reaction.symbol];
      if (direction !== "bullish" && direction !== "bearish") continue;
      total += 1;
      if ((direction === "bullish") === (reaction.abnormalPct > 0)) correct += 1;
    }
  }
  return { correct, total, accuracy: total ? percent(correct, total) : null };
}

const seedUrl = new URL("../app/data/seed-alerts.json", import.meta.url);
const rows = JSON.parse(await readFile(seedUrl, "utf8"));
if (!Array.isArray(rows)) fail("app/data/seed-alerts.json must contain an array");

const { unique, duplicates } = deduplicate(rows);
const excluded = { invalidPublishedAt: 0, noDirectSymbolReaction: 0, missingQqqReaction: 0 };
const labeled = unique.flatMap((row) => {
  const publishedAt = String(row.published_at || "");
  if (!Number.isFinite(Date.parse(publishedAt))) {
    excluded.invalidPublishedAt += 1;
    return [];
  }
  const outcome = label(row);
  if (outcome.reason === "no_direct_symbol_reaction") {
    excluded.noDirectSymbolReaction += 1;
    return [];
  }
  if (outcome.reason === "missing_qqq_reaction") {
    excluded.missingQqqReaction += 1;
    return [];
  }
  const result = scoreEvent(row);
  const score = number(result.priorityScore);
  if (score == null) fail(`scoreEvent(raw) returned a non-numeric priorityScore for ${publishedAt}`);
  return [{ publishedAt, score, result, ...outcome }];
}).sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));

if (labeled.length < 2) fail(`need at least two labeled events after filtering; found ${labeled.length}`);
const splitAt = Math.ceil(labeled.length * TRAIN_FRACTION);
if (!splitAt || splitAt === labeled.length) fail(`70/30 chronological split is empty (labeled=${labeled.length})`);
const training = labeled.slice(0, splitAt);
const test = labeled.slice(splitAt);
const { selected, criterion } = chooseThreshold(training);
const testMetrics = metric(test, selected.threshold);
const testAlerts = test.filter((row) => row.score >= selected.threshold);
const watchMetrics = metric(test, WATCH_THRESHOLD);
const alertMetrics = metric(test, ALERT_THRESHOLD);
const testDays = new Set(test.map((row) => dayOf(row.publishedAt))).size;
const directions = directionAccuracy(test, selected.threshold);

console.log("Historical deterministic scoreEvent(raw) baseline — not LLM accuracy");
console.log(`records: seed=${rows.length}, deduplicated=${unique.length}, removed_duplicates=${duplicates}`);
console.log(`labels: eligible=${labeled.length}, train=${training.length}, test=${test.length}, material_threshold=|symbol reaction - QQQ reaction|>=${MATERIAL_ABNORMAL_RETURN_PCT.toFixed(1)}%`);
console.log(`excluded: invalid_published_at=${excluded.invalidPublishedAt}, no_direct_symbol_reaction=${excluded.noDirectSymbolReaction}, missing_qqq_reaction=${excluded.missingQqqReaction} (QQQ benchmark limitation)`);
console.log(`base_rate: train=${percent(training.filter((row) => row.material).length, training.length).toFixed(1)}%, test=${percent(test.filter((row) => row.material).length, test.length).toFixed(1)}%`);
console.log(`production_watch_test: threshold=${WATCH_THRESHOLD}, precision=${watchMetrics.precision.toFixed(1)}%, recall=${watchMetrics.recall.toFixed(1)}%, FPR=${watchMetrics.fpr.toFixed(1)}%`);
console.log(`production_alert_test: threshold=${ALERT_THRESHOLD}, precision=${alertMetrics.precision.toFixed(1)}%, recall=${alertMetrics.recall.toFixed(1)}%, FPR=${alertMetrics.fpr.toFixed(1)}%`);
console.log(`exploratory_candidate: threshold=${selected.threshold} (${criterion}; train precision=${selected.precision.toFixed(1)}%, recall=${selected.recall.toFixed(1)}%, F1=${selected.f1.toFixed(1)}%)`);
console.log(`candidate_test: precision=${testMetrics.precision.toFixed(1)}%, recall=${testMetrics.recall.toFixed(1)}%, FPR=${testMetrics.fpr.toFixed(1)}% (TP=${testMetrics.tp}, FP=${testMetrics.fp}, TN=${testMetrics.tn}, FN=${testMetrics.fn})`);
console.log(`candidate_rate: ${testAlerts.length}/${testDays} labeled test-event days = ${(testAlerts.length / testDays).toFixed(2)} per day`);
console.log(`direction_accuracy: ${directions.accuracy == null ? "n/a (no alerted material direct-symbol direction predictions)" : `${directions.accuracy.toFixed(1)}% (${directions.correct}/${directions.total})`}`);
if (labeled.length < 100) console.log(`limitation: exploratory only; ${labeled.length} labeled events is below the 100-event release-calibration floor`);
