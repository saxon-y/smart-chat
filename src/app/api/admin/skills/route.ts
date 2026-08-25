import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, getRequestId, json } from "@/lib/http";

export const runtime = "nodejs";

const skillSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(2000).default(""),
  source: z.enum(["LOCAL", "URL"]).default("URL"),
  sourceRef: z.string().trim().max(2000).optional(),
  enabled: z.boolean().default(true),
});

function publicSkill(skill: { id: string; name: string; description: string; source: string; sourceRef: string | null; manifest: unknown; enabled: boolean; createdAt: Date; updatedAt: Date }) {
  return { id: skill.id, name: skill.name, description: skill.description, source: skill.source, sourceRef: skill.sourceRef, manifest: skill.manifest, enabled: skill.enabled, createdAt: skill.createdAt, updatedAt: skill.updatedAt };
}

export async function GET() {
  try {
    await requireAdmin();
    const skills = await db.skill.findMany({ orderBy: { createdAt: "asc" }, include: { _count: { select: { agents: true } } } });
    return json({ skills: skills.map((s) => ({ ...publicSkill(s), agentCount: s._count.agents })) });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载 Skills", 500, "SKILL_ERROR");
  }
}

async function fetchManifest(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow" });
    if (!response.ok) return { url, status: response.status, error: "fetch_failed" };
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      try { return { url, ...(await response.json() as Record<string, unknown>) }; } catch { return { url, contentType }; }
    }
    const text = await response.text();
    return { url, contentType, size: text.length, preview: text.slice(0, 280) };
  } catch {
    return { url, error: "fetch_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = skillSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return errorResponse("Skill 配置不合法", 400, "VALIDATION_ERROR");
    const { ...data } = parsed.data;
    const manifest = data.source === "URL" && data.sourceRef ? await fetchManifest(data.sourceRef) : null;
    const skill = await db.skill.create({ data: { ...data, manifest: manifest as Prisma.InputJsonValue } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "skill.create", targetType: "Skill", targetId: skill.id, after: { name: skill.name, source: skill.source, sourceRef: skill.sourceRef }, requestId: getRequestId(request) } });
    return json({ skill: publicSkill(skill) }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法添加 Skill", 500, "SKILL_ERROR");
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = await requireAdmin();
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!id) return errorResponse("缺少 Skill id", 400, "VALIDATION_ERROR");
    await db.skill.delete({ where: { id } });
    await db.auditLog.create({ data: { actorId: admin.id, action: "skill.delete", targetType: "Skill", targetId: id, requestId: getRequestId(request) } });
    return json({ ok: true });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法删除 Skill", 500, "SKILL_ERROR");
  }
}
