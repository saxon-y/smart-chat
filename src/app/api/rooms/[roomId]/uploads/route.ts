import { randomUUID } from "node:crypto";
import path from "node:path";
import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { roomPermission } from "@/lib/chat/rooms";
import { createArtifactStorage } from "@/lib/ai/artifact-storage";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"]);

export async function POST(request: Request, context: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await context.params;
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const member = await activeMembership(roomId, user.id);
  if (!member) return errorResponse("需要先加入该房间", 403, "FORBIDDEN");
  if (!await roomPermission(user.id, roomId, "canArtifacts")) return errorResponse("无权上传文件", 403, "FORBIDDEN");
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return errorResponse("文件必填", 400, "VALIDATION_ERROR");
  if (!ALLOWED.has(file.type.toLowerCase())) return errorResponse("不支持的文件类型", 415, "UNSUPPORTED_MEDIA_TYPE");
  if (file.size > MAX_BYTES) return errorResponse("文件过大（上限 10MB）", 413, "PAYLOAD_TOO_LARGE");
  const safeName = path.basename(file.name || "upload").replace(/[^\w.()\-\u4e00-\u9fff ]/g, "_").slice(0, 120) || "upload";
  const objectKey = `uploads/${roomId}/${randomUUID()}-${safeName}`;
  const storage = createArtifactStorage();
  const bytes = new Uint8Array(await file.arrayBuffer());
  const stored = await storage.put(objectKey, bytes);
  try {
    const artifact = await db.artifact.create({ data: { roomId, uploadedByMemberId: member.id, objectKey: stored.objectKey, mimeType: file.type.toLowerCase(), byteSize: stored.byteSize, sha256: stored.sha256 } });
    return json({ artifact: { id: artifact.id, mimeType: artifact.mimeType, byteSize: artifact.byteSize, name: safeName, url: `/api/artifacts/${artifact.id}` } }, { status: 201, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    await storage.delete(stored.objectKey).catch(() => undefined);
    throw error;
  }
}
