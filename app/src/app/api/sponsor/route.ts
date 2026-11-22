import { connection } from "next/server";
import { attempt, attemptSync } from "@/lib/chain/result";
import { MAX_SPONSOR_BODY_BYTES, readClientIp, resolveSponsorService } from "@/lib/chain/sponsor-service";

export async function GET() {
  await connection();
  const service = resolveSponsorService();
  if (!service.ok) {
    console.error(`[GET /api/sponsor] ${service.reason}`);
    return Response.json({ reason: "the sponsor is not configured" }, { status: 503 });
  }
  const reply = await service.value.describe();
  return Response.json(reply.body, { status: reply.status });
}

export async function POST(request: Request) {
  const service = resolveSponsorService();
  if (!service.ok) {
    console.error(`[POST /api/sponsor] ${service.reason}`);
    return Response.json({ reason: "the sponsor is not configured" }, { status: 503 });
  }
  const text = await attempt(() => request.text());
  if (!text.ok || text.value.length > MAX_SPONSOR_BODY_BYTES) return Response.json({ reason: "the body is unreadable or too large" }, { status: 413 });
  const body = attemptSync((): unknown => JSON.parse(text.value));
  if (!body.ok) return Response.json({ reason: "the body is not JSON" }, { status: 400 });
  const reply = await service.value.sponsor(body.value, readClientIp(request.headers));
  return Response.json(reply.body, { status: reply.status });
}
