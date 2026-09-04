import { getCurrentUser } from "@/lib/auth/session";
import { errorResponse, json } from "@/lib/http";
import { listRoomNavigation } from "@/lib/chat/rooms";
export async function GET() { const user = await getCurrentUser(); if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED"); return json({ rooms: await listRoomNavigation(user.id) }); }
