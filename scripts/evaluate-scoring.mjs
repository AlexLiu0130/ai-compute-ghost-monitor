import { access, readFile } from "node:fs/promises";
import { scoreEvent as deterministicScoreEvent } from "../app/lib/scoring.ts";

const fixtureUrl = new URL("../tests/fixtures/scoring-cases.json", import.meta.url);
const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8"));
const { scoreEventContract: contract, cases } = fixtures;

function percent(numerator, denominator) {
  return denominator ? (numerator / denominator) * 100 : 0;
}

function evaluate(results) {
  const expectedRelevant = cases.filter(({ expected }) => expected.relevant);
  const expectedAlerts = cases.filter(({ expected }) => expected.alert);
  const expectedDirections = cases.flatMap(({ expected }) => expected.ticker_impacts);
  const predictedRelevant = results.filter(({ result }) => result.relevant);
  const predictedAlerts = results.filter(({ result }) => result.alert);
  const trueRelevant = predictedRelevant.filter(({ item }) => item.expected.relevant).length;
  const trueAlerts = predictedAlerts.filter(({ item }) => item.expected.alert).length;
  const matchingDirections = results.flatMap(({ item, result }) => item.expected.ticker_impacts.filter((expected) =>
    result.ticker_impacts.some((actual) => actual.ticker === expected.ticker && actual.direction === expected.direction && actual.tier === expected.tier)
  )).length;
  const predictedDirections = results.flatMap(({ result }) => result.ticker_impacts);
  const falseRelevant = predictedRelevant.length - trueRelevant;
  const falseAlerts = predictedAlerts.length - trueAlerts;
  const complete = results.filter(({ result }) => result.complete).length;
  const metrics = {
    relevancePrecision: percent(trueRelevant, predictedRelevant.length),
    relevanceRecall: percent(trueRelevant, expectedRelevant.length),
    relevanceFalsePositiveRate: percent(falseRelevant, cases.length - expectedRelevant.length),
    alertFalseDiscoveryRate: percent(falseAlerts, predictedAlerts.length),
    alertFalsePositiveRate: percent(falseAlerts, cases.length - expectedAlerts.length),
    alertRecall: percent(trueAlerts, expectedAlerts.length),
    tickerDirectionTierRecall: percent(matchingDirections, expectedDirections.length),
    extraTickerRate: percent(Math.max(0, predictedDirections.length - matchingDirections), predictedDirections.length),
    resultCompleteness: percent(complete, results.length),
  };
  metrics.total = 0.20 * metrics.relevancePrecision
    + 0.15 * metrics.relevanceRecall
    + 0.10 * (100 - metrics.relevanceFalsePositiveRate)
    + 0.10 * (100 - metrics.alertFalseDiscoveryRate)
    + 0.05 * (100 - metrics.alertFalsePositiveRate)
    + 0.15 * metrics.alertRecall
    + 0.15 * metrics.tickerDirectionTierRecall
    + 0.05 * (100 - metrics.extraTickerRate)
    + 0.05 * metrics.resultCompleteness;
  return metrics;
}

function baselineResult(input) {
  const result = deterministicScoreEvent(input);
  return {
    relevant: result.ghost_score >= 20,
    alert: result.alert_level === "alert",
    ticker_impacts: Array.isArray(result.ticker_impacts) ? result.ticker_impacts : [],
    complete: false,
  };
}

function normalizeScoreEvent(result) {
  const hasFields = contract.requiredResultFields.every((field) => field in result);
  return {
    relevant: Boolean(result.critique?.inScope) && Number(result.priorityScore) >= contract.relevanceThreshold,
    alert: result.alertLevel === "alert",
    ticker_impacts: Array.isArray(result.impacts) ? result.impacts : [],
    complete: hasFields
      && Number.isFinite(result.priorityScore)
      && Array.isArray(result.impacts)
      && result.critique
      && Array.isArray(result.critique.hardGates)
      && Array.isArray(result.critique.caps),
  };
}

function printMetrics(label, metrics) {
  console.log(label);
  for (const [name, value] of Object.entries(metrics)) {
    const rendered = name === "total" ? `${value.toFixed(1)}/100` : `${value.toFixed(1)}%`;
    console.log(`  ${name}: ${rendered}`);
  }
}

async function loadScoreEvent() {
  const moduleUrl = new URL("../app/lib/scoring.ts", import.meta.url);
  try {
    await access(moduleUrl);
  } catch (error) {
    throw new Error(`Missing expected scoreEvent API: create ${contract.module} and export ${contract.export}(analysis).`);
  }
  const scoringModule = await import(moduleUrl.href);
  if (typeof scoringModule.scoreEvent !== "function") throw new Error(`Expected ${contract.module} to export ${contract.export}(analysis).`);
  return scoringModule.scoreEvent;
}

const baseline = cases.map((item) => ({ item, result: baselineResult(item.input) }));
printMetrics("deterministic raw-input baseline", evaluate(baseline));

try {
  const scoreEvent = await loadScoreEvent();
  const scored = await Promise.all(cases.map(async (item) => ({
    item,
    result: normalizeScoreEvent(await scoreEvent(item.score_event_input)),
  })));
  printMetrics("labeled-input score contract", evaluate(scored));
  console.log("Note: the second block is a contract check with labeled helper fields, not a fair model comparison or market-probability accuracy result.");
} catch (error) {
  console.log(`\n${error.message}`);
  console.log("Baseline metrics above are valid; new-score metrics require the API contract in tests/fixtures/scoring-cases.json.");
  process.exitCode = 1;
}
