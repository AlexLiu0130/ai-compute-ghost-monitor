import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activeJs = new URL("../public/site-app/monitor/main.js", import.meta.url);
const alertsRoute = new URL("../app/api/alerts/route.ts", import.meta.url);

test("active monitor uses the server scoring path and production thresholds", async () => {
  const source = await readFile(activeJs, "utf8");
  assert.match(source, /fetch\("\/api\/analyze"/);
  assert.doesNotMatch(source, /function analyzeLocal|ghostScore >= 60|ghostScore >= 20/);
  assert.match(source, /0-34[^\n]+35-64[^\n]+65-100/);
  assert.match(source, /Legacy score/);
});

test("monitor does not present legacy probabilities as forecasts", async () => {
  const source = await readFile(activeJs, "utf8");
  assert.doesNotMatch(source, /groupProb|probText|p_up|p_down|expected_reaction_pct/);
  assert.match(source, /ml_predictions/);
  assert.match(source, /not a price probability/);
  assert.match(await readFile(alertsRoute, "utf8"), /delete copy\.ml_predictions/);
});
