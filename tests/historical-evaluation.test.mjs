import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);

test("historical evaluation reports a chronological deterministic baseline", async () => {
  const { stdout } = await run(process.execPath, ["--experimental-strip-types", "scripts/evaluate-historical.mjs"]);
  for (const label of ["not LLM accuracy", "train=", "test=", "production_watch_test:", "production_alert_test:", "exploratory_candidate:", "candidate_test:", "candidate_rate:", "direction_accuracy:", "QQQ benchmark limitation", "exploratory only"]) {
    assert.match(stdout, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
