import { revokeCurrentSession } from "@/lib/auth/session";
import { json } from "@/lib/http";

export const runtime = "nodejs";

export async function POST() {
  await revokeCurrentSession();
  return json({ ok: true });
}

