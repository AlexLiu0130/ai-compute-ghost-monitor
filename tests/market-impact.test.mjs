import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateMarketImpact,
  expectedReactionDate,
  latestCompletedTradingDay,
  marketImpactNeedsRefresh,
} from "../app/lib/market-impact.ts";

test("weekend news waits for the next US trading session", () => {
  assert.equal(expectedReactionDate("2026-07-05T08:00:00Z"), "2026-07-06");
});

test("after-close news maps to the next US trading session", () => {
  assert.equal(expectedReactionDate("2026-07-06T21:30:00Z"), "2026-07-07");
});

test("Korean tickers use the Seoul session clock", () => {
  assert.equal(expectedReactionDate("2026-07-06T08:00:00Z", "005930.KS"), "2026-07-07");
});

test("latest completed session excludes an open market day", () => {
  assert.equal(latestCompletedTradingDay(new Date("2026-07-06T18:00:00Z")), "2026-07-02");
});

test("stale pending impact is eligible for refresh", () => {
  const row = {
    published_at: "2026-07-05T08:00:00Z",
    market_impact: [{ symbol: "NVDA", pending: "waiting_for_reaction_close", expected_reaction_date: "2026-07-06" }],
  };
  assert.equal(marketImpactNeedsRefresh(row, new Date("2026-07-07T22:00:00Z")), true);
});

test("reaction close and change use the first eligible trading bar", () => {
  const impact = calculateMarketImpact("NVDA", "2026-07-05T08:00:00Z", [
    { date: "2026-07-02", close: 100 },
    { date: "2026-07-06", close: 104 },
    { date: "2026-07-07", close: 106 },
  ]);
  assert.deepEqual(impact, {
    symbol: "NVDA",
    prev_date: "2026-07-02",
    reaction_trade_date: "2026-07-06",
    prev_close: 100,
    reaction_close: 104,
    next_close: 106,
    reaction_pct: 4,
    next_day_pct: 1.92,
    three_session_pct: null,
  });
});
