import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { syncCnMirror } from "../app/lib/cn-sync.ts";
import { createSyncServer, mergeRows } from "../deploy/cn-sync/server.mjs";

test("mirror sync retries with the same idempotency key", async () => {
  const calls = [];
  const fetcher = async (_url, options) => {
    calls.push(options);
    return calls.length === 1
      ? new Response("temporary", { status: 503 })
      : Response.json({ status: "applied" });
  };
  const result = await syncCnMirror(
    { CN_SYNC_URL: "https://ghost.example.cn/internal/sync/alerts", CN_SYNC_TOKEN: "secret" },
    [{ url: "https://example.com/1", published_at: "20260724T010716", title: "Latest" }],
    fetcher,
  );

  assert.equal(result.status, "synced");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].headers["x-idempotency-key"], calls[1].headers["x-idempotency-key"]);
  assert.equal(calls[0].headers.authorization, "Bearer secret");
});

test("mirror merge upserts by source key and sorts compact timestamps", () => {
  const rows = mergeRows(
    [{ url: "old", published_at: "2026-07-10T06:58:00Z", title: "Old" }],
    [
      { url: "old", published_at: "2026-07-10T06:58:00Z", title: "Updated" },
      { url: "new", published_at: "20260724T010716", title: "New" },
    ],
  );

  assert.deepEqual(rows.map((row) => row.title), ["New", "Updated"]);
});

test("sync endpoint requires its token and applies an idempotent atomic update", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "ghost-cn-sync-"));
  const alertsFile = join(directory, "alerts.json");
  const server = createSyncServer({ token: "sync-secret", alertsFile });
  server.listen(0, "127.0.0.1");
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/internal/sync/alerts`;
  const body = JSON.stringify({ version: 1, rows: [{ url: "new", published_at: "20260724T010716", title: "New" }] });
  const key = "a".repeat(64);

  assert.equal((await fetch(url, { method: "POST", body })).status, 401);
  const headers = {
    authorization: "Bearer sync-secret",
    "content-type": "application/json",
    "x-idempotency-key": key,
  };
  assert.equal((await fetch(url, { method: "POST", headers, body })).status, 200);
  assert.equal((await (await fetch(url, { method: "POST", headers, body })).json()).status, "already_applied");
  assert.equal(JSON.parse(await readFile(alertsFile, "utf8"))[0].title, "New");
});
