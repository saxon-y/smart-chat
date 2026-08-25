import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { json, errorResponse } from "@/lib/http";

export const runtime = "nodejs";

const AVATAR_DIR = join(process.cwd(), ".data", "avatars");

const TYPE_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
};

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const id = (await context.params).id;
  if (!/^[\w.-]+\.(png|jpe?g|webp|gif|bmp)$/i.test(id)) {
    return errorResponse("头像不存在", 404, "NOT_FOUND");
  }
  const filePath = join(AVATAR_DIR, id);
  try {
    const [data, info] = await Promise.all([readFile(filePath), stat(filePath)]);
    const ext = id.split(".").pop()!.toLowerCase();
    const type = TYPE_BY_EXT[ext] ?? "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": type,
        "Content-Length": String(info.size),
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return json({ error: { code: "NOT_FOUND", message: "头像不存在" } }, { status: 404 });
  }
}
