import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activeJs = new URL("../public/site-app/monitor/main.js", import.meta.url);
const alertsRoute = new URL("../app/api/alerts/route.ts", import.meta.url);
const developerPage = new URL("../public/site-app/developer.html", import.meta.url);
const siteCss = new URL("../public/site-app/site.css", import.meta.url);
const siteJs = new URL("../public/site-app/site.js", import.meta.url);

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

test("one malformed stored alert cannot force the entire API back to seed data", async () => {
  const source = await readFile(alertsRoute, "utf8");
  assert.match(source, /rows\.flatMap/);
  assert.match(source, /JSON\.parse\(row\.payload\)/);
  assert.match(source, /catch \{\s*return \[\];/);
});

test("developer page documents the implemented dual-agent safety architecture", async () => {
  const source = await readFile(developerPage, "utf8");
  assert.match(source, /ANALYST AGENT/);
  assert.match(source, /CRITIC AGENT/);
  assert.match(source, /100 分确定性评分/);
  assert.match(source, /D1 MEMORY/);
  assert.match(source, /未复核结果最高 59 分/);
  assert.equal((source.match(/class="agent-link"/g) || []).length, 4);
});

test("agent architecture motion is staged and respects reduced-motion", async () => {
  const [css, js] = await Promise.all([
    readFile(siteCss, "utf8"),
    readFile(siteJs, "utf8"),
  ]);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(css, /@keyframes agent-node-enter/);
  assert.match(css, /@keyframes agent-packet/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
