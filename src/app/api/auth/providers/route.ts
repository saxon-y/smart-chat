import { json } from "@/lib/http";
import { oauthProviderAvailability } from "@/lib/auth/oauth";

export const runtime = "nodejs";

export async function GET() {
  return json({ providers: oauthProviderAvailability() });
}
