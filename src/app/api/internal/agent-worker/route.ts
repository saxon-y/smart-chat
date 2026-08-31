import { timingSafeEqual } from "node:crypto";
import { recoverPendingAiRuns } from "@/lib/ai/service";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.AGENT_WORKER_SECRET;
  if (!secret) return process.env.NODE_ENV !== "production";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expectedBytes = Buffer.from(secret);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export async function POST(request: Request) {
  if (!authorized(request)) return errorResponse("Worker 未授权", 401, "UNAUTHORIZED");
  const processed = await recoverPendingAiRuns(20);
  return json({ processed });
}
