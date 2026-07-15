import { env } from "cloudflare:workers";
import { runCapture } from "../../lib/capture";

export async function POST(request: Request) {
  try {
    const token = (env as unknown as { CAPTURE_TOKEN?: string }).CAPTURE_TOKEN;
    if (token && request.headers.get("x-capture-token") !== token) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    return Response.json(await runCapture(env as unknown as Parameters<typeof runCapture>[0]));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "capture failed" }, { status: 500 });
  }
}
