import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

type LocalSkill = { name: string; root: string; path: string; hasManifest: boolean };

async function scanDir(root: string, label: string): Promise<LocalSkill[]> {
  const results: LocalSkill[] = [];
  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dirPath = path.join(root, entry.name);
    const hasManifest = await Promise.all(["SKILL.md", "skill.md", "skill.json", "package.json"].map((f) =>
      fs.stat(path.join(dirPath, f)).then(() => true).catch(() => false),
    )).then((flags) => flags.some(Boolean));
    results.push({ name: entry.name, root: label, path: dirPath, hasManifest });
  }
  return results;
}

export async function GET() {
  try {
    await requireAdmin();
    const home = os.homedir();
    const roots = [
      { path: path.join(home, ".codex", "skills"), label: "codex" },
      { path: path.join(home, ".codex", "agents"), label: "codex-agents" },
      { path: path.join(home, ".claude", "skills"), label: "claude" },
      { path: path.join(home, ".claude", "agents"), label: "claude-agents" },
    ];
    const groups = await Promise.all(roots.map((r) => scanDir(r.path, r.label)));
    const skills = groups.flat().sort((a, b) => a.name.localeCompare(b.name));
    return json({ skills, home });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法扫描本地 Skills", 500, "SKILL_SCAN_ERROR");
  }
}
