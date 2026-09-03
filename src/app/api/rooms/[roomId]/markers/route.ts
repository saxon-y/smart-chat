import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { listMarkers, toggleMarker } from "@/lib/chat/markers";
import { errorResponse, json } from "@/lib/http";
export const runtime = "nodejs";
async function auth(roomId: string) { const user = await getCurrentUser(); if (!user) return { error: errorResponse("需要先登录", 401, "UNAUTHENTICATED") }; const member = await activeMembership(roomId, user.id); if (!member) return { error: errorResponse("需要先加入该房间", 403, "FORBIDDEN") }; return { member }; }
export async function GET(_: Request, context: { params: Promise<{ roomId: string }> }) { const roomId = (await context.params).roomId; const a = await auth(roomId); if (a.error) return a.error; return json(await listMarkers(roomId, a.member.id)); }
export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) { const roomId = (await context.params).roomId; const a = await auth(roomId); if (a.error) return a.error; const body = await request.json().catch(() => ({})); if (!['pin','bookmark'].includes(body.type) || typeof body.messageId !== 'string' || typeof body.active !== 'boolean') return errorResponse("参数不合法", 400, "VALIDATION_ERROR"); try { return json({ marker: await toggleMarker({ roomId, memberId: a.member.id, type: body.type, messageId: body.messageId, active: body.active }) }); } catch (e) { const message = e instanceof Error ? e.message : "操作失败"; return errorResponse(message, message === "PIN_FORBIDDEN" ? 403 : message === "MESSAGE_NOT_FOUND" ? 404 : 400, message); } }
