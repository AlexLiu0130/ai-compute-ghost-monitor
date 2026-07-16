import assert from "node:assert/strict";
import test from "node:test";
import { analyze, applySemanticJudgment } from "../app/lib/ghost.ts";

test("weighted ghost rules separate strong events from weak holdings news", () => {
  const overcapacity = analyze({
    title: "Meta reportedly plans to sell excess AI compute capacity",
    summary: "Low utilization and excess compute raise concerns about AI capex return on investment.",
    source: "Reuters / Bloomberg",
    symbols: ["META", "NVDA"],
  });
  assert.equal(overcapacity.ghost_type, "compute_overcapacity");
  assert.equal(overcapacity.alert_level, "alert");

  const holding = analyze({
    title: "PFG Investments LLC Has $36.84 Million Position in Amazon.com, Inc. $AMZN",
    summary: "The fund increased its stake in Amazon shares and analysts keep a buy rating.",
    source: "MarketBeat",
    symbols: ["AMZN"],
  });
  assert.equal(holding.alert_level, "log");
  assert.ok(holding.ghost_score < 20);

  const shortage = analyze({
    title: "Micron forecasts upbeat revenue on strong AI memory chip demand",
    summary: "HBM shortage, sold out capacity and supply tightness support memory pricing.",
    source: "Reuters",
    symbols: ["MU", "NVDA"],
  });
  assert.equal(shortage.ghost_type, "hbm_shortage");
  assert.equal(shortage.ticker_directions.MU, "bullish");
});

test("semantic judgment can promote non-keyword events and cap weak articles", () => {
  const subtle = analyze({
    title: "Cloud provider offers unused GPU clusters to external customers",
    summary: "The company is trying to rent spare AI infrastructure after internal demand came in below plan.",
    source: "Reuters",
    symbols: ["META", "NVDA"],
  });
  applySemanticJudgment(subtle, { ghost_type: "compute_overcapacity", strength: 3, reason: "spare GPU infrastructure implies excess compute supply" });
  assert.equal(subtle.ghost_type, "compute_overcapacity");
  assert.equal(subtle.alert_level, "alert");

  const listicle = analyze({
    title: "Best semiconductor stocks to buy this month",
    summary: "Analysts discuss AI chip winners and price targets.",
    source: "Yahoo Finance",
    symbols: ["NVDA"],
  });
  applySemanticJudgment(listicle, { ghost_type: "ordinary_ai_news", strength: 0, reason: "generic stock-pick article" });
  assert.equal(listicle.alert_level, "log");
  assert.ok(listicle.ghost_score < 20);
});
