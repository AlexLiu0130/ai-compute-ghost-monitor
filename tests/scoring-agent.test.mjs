import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const fixtureUrl = new URL("./fixtures/scoring-cases.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
const contract = fixtures.scoreEventContract;

async function loadScoreEvent() {
  const moduleUrl = new URL("../app/lib/scoring.ts", import.meta.url);
  try {
    await access(moduleUrl);
  } catch (error) {
    throw new Error(`Missing expected scoreEvent API: create ${contract.module} and export ${contract.export}(analysis).`);
  }
  const scoringModule = await import(moduleUrl.href);
  assert.equal(typeof scoringModule.scoreEvent, "function", "Expected app/lib/scoring.ts to export scoreEvent(analysis).");
  return scoringModule.scoreEvent;
}

function assertImpact(result, expected) {
  const actual = result.impacts.find((impact) => impact.ticker === expected.ticker);
  assert.ok(actual, `Missing ${expected.tier} impact for ${expected.ticker}.`);
  assert.equal(actual.tier, expected.tier, `${expected.ticker} tier`);
  assert.equal(actual.direction, expected.direction, `${expected.ticker} direction`);
}

test("scoring fixture corpus covers the required semantic traps and ticker tiers", () => {
  const ids = new Set(fixtures.cases.map(({ id }) => id));
  for (const id of [
    "real-compute-overcapacity",
    "hbm-shortage-chain-impact",
    "holdings-article-with-capacity-expansion",
    "paccar-freight-overcapacity",
    "nasdaq-employee-incentive",
    "duplicate-low-quality-source",
    "conflicting-hbm-evidence",
  ]) assert.ok(ids.has(id), `Missing fixture: ${id}`);

  const tiers = new Set(fixtures.cases.flatMap(({ expected }) => expected.ticker_impacts.map(({ tier }) => tier)));
  assert.deepEqual([...tiers].sort(), [...contract.tickerImpact.tiers].sort());
});

test("scoreEvent satisfies every labeled scoring case", async () => {
  const scoreEvent = await loadScoreEvent();
  for (const item of fixtures.cases) {
    const result = await scoreEvent(item.score_event_input);
    assert.ok(result && typeof result === "object", `${item.id}: scoreEvent must return an object.`);
    for (const field of contract.requiredResultFields) assert.ok(field in result, `${item.id}: missing result.${field}.`);
    assert.ok(Number.isFinite(result.priorityScore) && result.priorityScore >= 0 && result.priorityScore <= 100, `${item.id}: priorityScore must be 0-100.`);
    assert.ok(["log", "watch", "alert"].includes(result.alertLevel), `${item.id}: invalid alertLevel.`);
    assert.equal(Array.isArray(result.impacts), true, `${item.id}: impacts must be an array.`);
    assert.ok(result.critique && typeof result.critique === "object", `${item.id}: critique must be an object.`);
    assert.equal(Array.isArray(result.critique.hardGates), true, `${item.id}: critique.hardGates must be an array.`);
    assert.equal(Array.isArray(result.critique.caps), true, `${item.id}: critique.caps must be an array.`);
    assert.equal(result.critique.inScope && result.priorityScore >= contract.relevanceThreshold, item.expected.relevant, `${item.id}: relevance classification`);
    assert.equal(result.alertLevel === "alert", item.expected.alert, `${item.id}: alert classification`);
    assert.equal(result.critique.inScope, item.expected.in_scope, `${item.id}: scope gate`);
    assert.equal(result.critique.caps.some((cap) => cap.startsWith("conflicting_sources_cap=")), item.expected.has_conflict, `${item.id}: conflict handling`);
    for (const impact of item.expected.ticker_impacts) assertImpact(result, impact);
  }
});

test("semantic features are evidence-bound and critic downgrade changes the result", async () => {
  const { scoreEvent } = await import(new URL("../app/lib/scoring.ts", import.meta.url).href);
  const { validateAnalysis } = await import(new URL("../app/lib/agent-harness.ts", import.meta.url).href);
  const row = {
    title: "Meta offers unused GPU capacity after internal AI demand misses plan",
    summary: "The company is offering spare clusters to external customers.",
    source: "Reuters",
    symbols: ["META", "NVDA"],
  };
  const analysis = {
    event_type: "compute_overcapacity", is_market_event: true, strength: 3, confidence: 3,
    features: { event_actuality: 3, novelty: 3, surprise: 2, magnitude: 3, direct_exposure: 3, causal_strength: 3, breadth: 2, persistence: 2, uncertainty: 0 },
    ticker_impacts: [{ ticker: "META", direction: "mixed", tier: "direct" }, { ticker: "NVDA", direction: "bearish", tier: "first_order" }],
    evidence: [{ field: "summary", quote: "offering spare clusters", claim: "unused capacity is being externalized" }], conflicts: [],
  };
  assert.ok(validateAnalysis(analysis, row));
  assert.equal(validateAnalysis({ ...analysis, evidence: [{ field: "summary", quote: "invented evidence", claim: "unsupported" }] }, row), null);
  assert.equal(validateAnalysis({ ...analysis, evidence: [{ field: "summary", quote: "", claim: "unsupported" }] }, row), null);
  assert.equal(validateAnalysis({ ...analysis, confidence: 0.84 }, row), null);
  assert.equal(validateAnalysis({ ...analysis, features: { ...analysis.features, magnitude: 0.9 } }, row), null);
  assert.equal(validateAnalysis({ ...analysis, ticker_impacts: [{ ticker: "MU", direction: "bullish", tier: "direct" }] }, row), null);
  assert.ok(validateAnalysis({ ...analysis, ticker_impacts: [{ ticker: "MU", direction: "bearish", tier: "first_order" }] }, row));
  assert.equal(validateAnalysis({ ...analysis, ticker_impacts: [{ ticker: "PCAR", direction: "bullish", tier: "direct" }] }, { ...row, symbols: ["META", "PCAR"] }), null);
  const confirmed = scoreEvent(row, analysis);
  const downgraded = scoreEvent(row, analysis, { verdict: "downgrade", confidence: 3, evidence: [], conflicts: [], corrections: {}, unsupported_tickers: ["NVDA"] });
  assert.deepEqual(Object.fromEntries(["eventConfidence", "impactPotential", "directionConfidence"].map((field) => [field, confirmed[field]])), { eventConfidence: 100, impactPotential: 83, directionConfidence: 100 });
  assert.equal(confirmed.priorityScore, 92);
  assert.equal(confirmed.alertLevel, "alert");
  assert.notEqual(downgraded.alertLevel, "alert");
  assert.equal(downgraded.impacts.some(({ ticker }) => ticker === "NVDA"), false);
});

test("QVeris truncated results recover only complete feed entries", async () => {
  const { recoverTruncatedFeed } = await import(new URL("../app/lib/qveris-result.ts", import.meta.url).href);
  const prefix = '{"items":"3","feed":[{"title":"one","summary":"brace } in text"},{"title":"two","nested":{"ok":true}},{"title":"incomplete"';
  assert.deepEqual(recoverTruncatedFeed(prefix), [
    { title: "one", summary: "brace } in text" },
    { title: "two", nested: { ok: true } },
  ]);
  assert.deepEqual(recoverTruncatedFeed('{"feed":[{"title":"complete"}]}'), [{ title: "complete" }]);
  assert.deepEqual(recoverTruncatedFeed("error code: 1003"), []);
});

test("dual-agent harness runs one analysis and one bounded critique", async () => {
  const { reviewEvent } = await import(new URL("../app/lib/agent-harness.ts", import.meta.url).href);
  const { scoreEvent, shouldCritique } = await import(new URL("../app/lib/scoring.ts", import.meta.url).href);
  const row = { title: "Meta offers unused GPU capacity", summary: "Meta is offering spare GPU clusters after internal AI demand missed plan.", source: "Reuters", symbols: ["META", "NVDA"] };
  const replies = [
    { event_type: "compute_overcapacity", is_market_event: true, strength: 3, confidence: 3, features: { event_actuality: 3, novelty: 3, surprise: 2, magnitude: 3, direct_exposure: 3, causal_strength: 3, breadth: 2, persistence: 2, uncertainty: 0 }, ticker_impacts: [{ ticker: "META", direction: "mixed", tier: "direct" }, { ticker: "NVDA", direction: "bearish", tier: "first_order" }], evidence: [{ field: "summary", quote: "offering spare GPU clusters", claim: "unused capacity is being externalized" }], conflicts: [] },
    { verdict: "downgrade", confidence: 3, evidence: [], conflicts: [], corrections: {}, unsupported_tickers: ["NVDA"] },
  ];
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(replies[calls++]) } }] }) });
  try {
    const reviewed = await reviewEvent({ ...row }, "test-key", scoreEvent, shouldCritique, true);
    assert.equal(calls, 2);
    assert.equal(reviewed.alert_level, "watch");
    assert.equal(reviewed.ticker_impacts.some(({ ticker }) => ticker === "NVDA"), false);
    assert.equal(reviewed.agent_trace.analysis.status, "ok");
    assert.equal(reviewed.agent_trace.critique.status, "ok");
  } finally {
    globalThis.fetch = originalFetch;
  }
  const fallback = await reviewEvent(scoreEvent(row), undefined, scoreEvent, shouldCritique, true);
  assert.ok(fallback.ghost_score <= 39);
  assert.equal(fallback.priorityScore, fallback.ghost_score);
  assert.equal(fallback.alertLevel, fallback.alert_level);
  assert.notEqual(fallback.alert_level, "alert");
});

test("failed critique preserves validated analysis but cannot trigger an alert", async () => {
  const { reviewEvent } = await import(new URL("../app/lib/agent-harness.ts", import.meta.url).href);
  const { scoreEvent, shouldCritique } = await import(new URL("../app/lib/scoring.ts", import.meta.url).href);
  const row = { title: "Meta offers unused GPU capacity", summary: "Meta is offering spare GPU clusters after internal AI demand missed plan.", source: "Reuters", symbols: ["META", "NVDA"] };
  const analysis = { event_type: "compute_overcapacity", is_market_event: true, strength: 3, confidence: 3, features: { event_actuality: 3, novelty: 3, surprise: 2, magnitude: 3, direct_exposure: 3, causal_strength: 3, breadth: 2, persistence: 2, uncertainty: 0 }, ticker_impacts: [{ ticker: "META", direction: "mixed", tier: "direct" }, { ticker: "NVDA", direction: "bearish", tier: "first_order" }], evidence: [{ field: "summary", quote: "offering spare GPU clusters", claim: "unused capacity is being externalized" }], conflicts: [] };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: calls++ === 0 ? JSON.stringify(analysis) : "{}" } }] }) });
  try {
    const result = await reviewEvent({ ...row }, "test-key", scoreEvent, shouldCritique, true);
    assert.equal(result.analysis_method, "llm_unreviewed");
    assert.ok(result.evidence.length > 0);
    assert.ok(result.score_critique.llmFeatures);
    assert.ok(result.ghost_score <= 59);
    assert.notEqual(result.alert_level, "alert");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analysis fallback is marked as v3 and cannot trigger an alert", async () => {
  const { reviewEvent } = await import(new URL("../app/lib/agent-harness.ts", import.meta.url).href);
  const { scoreEvent, shouldCritique } = await import(new URL("../app/lib/scoring.ts", import.meta.url).href);
  const row = { title: "AI infrastructure update", summary: "No verified market event.", ghost_score: 81 };
  const result = await reviewEvent(row, undefined, scoreEvent, shouldCritique, true);
  assert.equal(result.scoring_version, "anchored-v3");
  assert.equal(result.scoring_method, "rules_fallback");
  assert.ok(result.ghost_score <= 39);
  assert.notEqual(result.alert_level, "alert");
});
