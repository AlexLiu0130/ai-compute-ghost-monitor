import { env } from "cloudflare:workers";
import { runCapture } from "../../lib/capture";

export async function POST() {
  try {
    return Response.json(await runCapture(env as unknown as Parameters<typeof runCapture>[0]));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "capture failed" }, { status: 500 });
  }
}
