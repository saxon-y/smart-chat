export const messageBodySchema = { max: 4000 };
export function validateMessageBody(value: unknown, allowEmpty = false) {
  if (typeof value !== "string") return { ok: false as const, message: "请输入消息内容" };
  const body = value.trim();
  if (!body) {
    if (allowEmpty) return { ok: true as const, body: "" };
    return { ok: false as const, message: "请输入消息内容" };
  }
  if (body.length > messageBodySchema.max) return { ok: false as const, message: "消息内容过长" };
  return { ok: true as const, body };
}

export type ImageAttachment = { type: "image"; dataUrl: string; name?: string };
export type ArtifactAttachment = { type: "artifact"; artifactId: string; name?: string };
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024;
export const IMAGE_MAX_COUNT = 4;

export function validateAttachments(raw: unknown): { ok: true; attachments: ImageAttachment[] } | { ok: false; message: string } {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return { ok: true, attachments: [] };
  if (raw.length > IMAGE_MAX_COUNT) return { ok: false, message: `最多 ${IMAGE_MAX_COUNT} 张图片` };
  const attachments: ImageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, message: "图片信息不合法" };
    const a = item as Record<string, unknown>;
    if (a.type !== "image" || typeof a.dataUrl !== "string") return { ok: false, message: "图片信息不合法" };
    if (!a.dataUrl.startsWith("data:image/")) return { ok: false, message: "仅支持图片" };
    // ~4/3 base64 inflation; approximate decoded size.
    const approxBytes = Math.floor((a.dataUrl.length - a.dataUrl.indexOf(",") - 1) * 0.75);
    if (approxBytes > IMAGE_MAX_BYTES) return { ok: false, message: "图片过大（上限 3MB）" };
    attachments.push({ type: "image", dataUrl: a.dataUrl, name: typeof a.name === "string" ? a.name : undefined });
  }
  return { ok: true, attachments };
}

export function validateArtifactAttachments(raw: unknown): { ok: true; attachments: ArtifactAttachment[] } | { ok: false; message: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: true, attachments: [] };
  if (raw.length > IMAGE_MAX_COUNT) return { ok: false, message: `最多 ${IMAGE_MAX_COUNT} 个附件` };
  const attachments: ArtifactAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, message: "附件信息不合法" };
    const a = item as Record<string, unknown>;
    if (a.type !== "artifact" || typeof a.artifactId !== "string" || !a.artifactId || a.artifactId.length > 100) return { ok: false, message: "附件信息不合法" };
    attachments.push({ type: "artifact", artifactId: a.artifactId, name: typeof a.name === "string" ? a.name.slice(0, 120) : undefined });
  }
  return { ok: true, attachments };
}
export function extractMentionNames(body: string) {
  return [...body.matchAll(/(?:^|\s)@([^\s@]+)/g)].map((match) => match[1]).filter(Boolean);
}
