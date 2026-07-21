import { env } from "cloudflare:workers";
import { runHistoryBatch } from "../../lib/capture";

export async function POST(request: Request) {
  try {
    const token = (env as unknown as { HISTORY_TOKEN?: string }).HISTORY_TOKEN;
    if (!token) return Response.json({ error: "history endpoint is disabled" }, { status: 503 });
    if (request.headers.get("x-history-token") !== token) return Response.json({ error: "unauthorized" }, { status: 401 });
    return Response.json(await runHistoryBatch(env as unknown as Parameters<typeof runHistoryBatch>[0]));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message.slice(0, 300) : "history reprocess failed" }, { status: 500 });
  }
}
