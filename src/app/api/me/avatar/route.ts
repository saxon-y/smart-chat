import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

const AVATAR_DIR = join(process.cwd(), ".data", "avatars");
const MAX_BYTES = 2 * 1024 * 1024;

const EXT_BY_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
};

function publicUser(user: { id: string; email: string; displayName: string; avatarKey: string | null; role: string; createdAt: Date }) {
  return { id: user.id, email: user.email, displayName: user.displayName, avatarKey: user.avatarKey, role: user.role, createdAt: user.createdAt };
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return errorResponse("需要先登录", 401, "UNAUTHENTICATED");

  const form = await request.formData().catch(() => null);
  const file = form?.get("avatar");
  if (!(file instanceof File)) return errorResponse("未收到头像文件", 400, "VALIDATION_ERROR");
  if (file.size === 0) return errorResponse("头像文件为空", 400, "VALIDATION_ERROR");
  if (file.size > MAX_BYTES) return errorResponse("头像过大（上限 2MB）", 400, "VALIDATION_ERROR");

  const ext = EXT_BY_TYPE[file.type] ?? (file.type.split("/")[1] || "");
  if (!ext) return errorResponse("仅支持图片格式（png/jpg/webp/gif）", 400, "VALIDATION_ERROR");

  const id = `${crypto.randomUUID()}.${ext}`;
  await mkdir(AVATAR_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(join(AVATAR_DIR, id), buffer);

  const avatarKey = `/api/avatars/${id}`;
  const updated = await db.user.update({ where: { id: user.id }, data: { avatarKey } });
  return json({ user: publicUser(updated) });
}
