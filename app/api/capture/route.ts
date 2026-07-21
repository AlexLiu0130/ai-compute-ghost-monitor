import { env } from "cloudflare:workers";
import { recordCaptureFailure, runCapture } from "../../lib/capture";

export async function POST(request: Request) {
  try {
    const token = (env as unknown as { CAPTURE_TOKEN?: string }).CAPTURE_TOKEN;
    if (!token) return Response.json({ error: "capture endpoint is disabled" }, { status: 503 });
    if (request.headers.get("x-capture-token") !== token) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return Response.json(await runCapture(env as unknown as Parameters<typeof runCapture>[0]));
  } catch (error) {
    await recordCaptureFailure(env as unknown as Parameters<typeof runCapture>[0], error);
    const message = error instanceof Error ? error.message.slice(0, 300) : "capture failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
