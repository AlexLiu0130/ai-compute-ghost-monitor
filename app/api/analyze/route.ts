import { analyze } from "../../lib/ghost";

export async function POST(request: Request) {
  try {
    const payload = await request.json() as Record<string, unknown>;
    if (!String(payload.title || "").trim()) return Response.json({ error: "title is required" }, { status: 400 });
    return Response.json(analyze(payload));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "invalid request" }, { status: 400 });
  }
}
