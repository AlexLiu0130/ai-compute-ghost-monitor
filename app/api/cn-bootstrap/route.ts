import { env } from "cloudflare:workers";
import { bootstrapCnMirror } from "../../lib/capture";

async function tokenMatches(actual: string, expected: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
  const [left, right] = await Promise.all([digest(actual), digest(expected)]);
  return left.every((byte, index) => byte === right[index]);
}

export async function POST(request: Request) {
  const runtime = env as unknown as Parameters<typeof bootstrapCnMirror>[0] & {
    CN_BOOTSTRAP_TOKEN?: string;
  };
  if (!runtime.CN_BOOTSTRAP_TOKEN) {
    return Response.json({ error: "bootstrap endpoint is disabled" }, { status: 503 });
  }
  const token = request.headers.get("x-cn-bootstrap-token") || "";
  if (!await tokenMatches(token, runtime.CN_BOOTSTRAP_TOKEN)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return Response.json(await bootstrapCnMirror(runtime));
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "bootstrap failed";
    return Response.json({ error: message }, { status: 500 });
  }
}
