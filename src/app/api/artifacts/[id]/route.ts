import { getCurrentUser } from "@/lib/auth/session";
import { activeMembership } from "@/lib/chat";
import { db } from "@/lib/db";
import { errorResponse } from "@/lib/http";
import { createArtifactStorage } from "@/lib/ai/artifact-storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");
  const artifact = await db.artifact.findUnique({ where: { id: (await context.params).id }, include: { run: { select: { roomId: true } } } });
  if ((!artifact?.run && !artifact?.roomId) || artifact.deletedAt) return errorResponse("文件不存在", 404, "NOT_FOUND");
  const artifactRoomId = artifact.roomId ?? artifact.run?.roomId;
  if (!artifactRoomId || !await activeMembership(artifactRoomId, user.id)) return errorResponse("无权访问该文件", 403, "FORBIDDEN");
  const bytes = await createArtifactStorage().get(artifact.objectKey);
  if (!bytes) return errorResponse("图片文件不存在", 404, "NOT_FOUND");
  return new Response(new Uint8Array(bytes), { headers: { "content-type": artifact.mimeType, "content-disposition": "inline", "content-length": String(bytes.length), "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
}
