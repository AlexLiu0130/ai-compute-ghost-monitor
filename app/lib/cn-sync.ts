type SyncEnv = {
  CN_SYNC_URL?: string;
  CN_SYNC_TOKEN?: string;
};

type Row = Record<string, unknown>;

export type CnSyncResult =
  | { status: "disabled" | "skipped"; rows: 0 }
  | { status: "synced"; rows: number; idempotency_key: string };

function rowKey(row: Row) {
  return String(row.url || `${row.published_at || ""}:${row.title || ""}`);
}

async function batchKey(rows: Row[]) {
  const stable = [...rows]
    .sort((a, b) => rowKey(a).localeCompare(rowKey(b)))
    .map((row) => [rowKey(row), row]);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(stable)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function syncCnMirror(
  env: SyncEnv,
  rows: Row[],
  fetcher: typeof fetch = fetch,
): Promise<CnSyncResult> {
  if (!env.CN_SYNC_URL && !env.CN_SYNC_TOKEN) return { status: "disabled", rows: 0 };
  if (!env.CN_SYNC_URL || !env.CN_SYNC_TOKEN) throw new Error("CN mirror sync is partially configured");
  if (!rows.length) return { status: "skipped", rows: 0 };

  const url = new URL(env.CN_SYNC_URL);
  if (url.protocol !== "https:") throw new Error("CN_SYNC_URL must use HTTPS");

  const idempotencyKey = await batchKey(rows);
  const body = JSON.stringify({ version: 1, rows });
  let lastError = "unknown error";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.CN_SYNC_TOKEN}`,
          "content-type": "application/json",
          "x-idempotency-key": idempotencyKey,
        },
        body,
        signal: AbortSignal.timeout(12_000),
      });
      if (response.ok) return { status: "synced", rows: rows.length, idempotency_key: idempotencyKey };
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "request failed";
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }

  throw new Error(`CN mirror sync failed after 3 attempts: ${lastError}`);
}
