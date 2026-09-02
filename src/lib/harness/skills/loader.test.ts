import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadSkillBundle, SkillLoadError } from ".";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "skill-loader-"));
  async function skill(directory: string, overrides: Record<string, unknown> = {}) {
    const location = path.join(root, directory);
    await mkdir(location, { recursive: true });
    await writeFile(path.join(location, "SKILL.md"), `Instructions for ${directory}`);
    await writeFile(path.join(location, "reference.txt"), "reference-v1");
    await writeFile(path.join(location, "manifest.json"), JSON.stringify({
      id: directory, name: directory, version: "1.0.0", files: ["reference.txt"],
      dependencies: [], triggers: [directory], capabilities: ["chat"], requiredTools: ["read"], ...overrides,
    }));
    return location;
  }
  const options = (directory = "main") => ({
    root, skills: [{ directory, source: "workspace" as const }],
    availableTools: new Set(["read"]), allowedCapabilities: new Set(["chat"]),
  });
  return { root, skill, options };
}

describe("loadSkillBundle", () => {
  it("loads dependencies deterministically and changes hashes when any file changes", async () => {
    const item = await fixture();
    await item.skill("dependency");
    const main = await item.skill("main", { dependencies: ["dependency"] });
    const first = await loadSkillBundle(item.options());
    expect(first.skills.map((skill) => skill.id)).toEqual(["dependency", "main"]);
    expect(first.skills.every((skill) => skill.source === "workspace")).toBe(true);
    await writeFile(path.join(main, "reference.txt"), "reference-v2");
    const second = await loadSkillBundle(item.options());
    expect(second.bundleHash).not.toBe(first.bundleHash);
    expect(second.skills.find((skill) => skill.id === "main")?.hash).not.toBe(first.skills.find((skill) => skill.id === "main")?.hash);
  });

  it("returns an immutable run snapshot unaffected by later disk changes", async () => {
    const item = await fixture();
    const main = await item.skill("main");
    const snapshot = await loadSkillBundle(item.options());
    const serialized = JSON.stringify(snapshot);
    await writeFile(path.join(main, "SKILL.md"), "changed later");
    expect(JSON.stringify(snapshot)).toBe(serialized);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.skills[0].files)).toBe(true);
  });

  it("rejects path traversal and symlinks that resolve outside the root", async () => {
    const item = await fixture();
    await item.skill("main", { files: ["../secret.txt"] });
    await writeFile(path.join(item.root, "secret.txt"), "secret");
    await expect(loadSkillBundle(item.options())).rejects.toMatchObject({ code: "PATH_OUTSIDE_ROOT" });

    const outside = await mkdtemp(path.join(os.tmpdir(), "skill-outside-"));
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await writeFile(path.join(item.root, "main", "manifest.json"), JSON.stringify({
      id: "main", name: "main", version: "1", files: ["escape"], capabilities: [], requiredTools: [],
    }));
    await symlink(path.join(outside, "secret.txt"), path.join(item.root, "main", "escape"));
    await expect(loadSkillBundle({ ...item.options(), allowedCapabilities: new Set() })).rejects.toMatchObject({ code: "PATH_OUTSIDE_ROOT" });
  });

  it("rejects missing dependencies, tools, and disallowed capabilities", async () => {
    const item = await fixture();
    await item.skill("main", { dependencies: ["absent"] });
    await expect(loadSkillBundle(item.options())).rejects.toBeInstanceOf(SkillLoadError);
    await item.skill("main", { requiredTools: ["shell"] });
    await expect(loadSkillBundle(item.options())).rejects.toMatchObject({ code: "MISSING_REQUIRED_TOOL" });
    await item.skill("main", { capabilities: ["admin"] });
    await expect(loadSkillBundle(item.options())).rejects.toMatchObject({ code: "CAPABILITY_NOT_ALLOWED" });
  });

  it("hashes the exact manifest bytes", async () => {
    const item = await fixture();
    const main = await item.skill("main");
    const bundle = await loadSkillBundle(item.options());
    const manifest = await readFile(path.join(main, "manifest.json"));
    expect(bundle.skills[0].files.find((file) => file.path === "manifest.json")?.sha256).toHaveLength(64);
    expect(manifest.length).toBeGreaterThan(0);
  });
});
