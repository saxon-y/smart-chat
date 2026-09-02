import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  HARNESS_MARKER_BEGIN,
  HARNESS_MARKER_END,
  atomicWriteWithinWorkspace,
  prepareRuntimeWorkspace,
} from "./context-mapper";

const roots: string[] = [];
const context = {
  system: "system policy",
  agent: "agent profile",
  task: "do the task",
  roomContext: "room history",
  memory: "durable memory",
  policy: { allowedTools: ["read"] },
};

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "smart-chat-context-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runtime context mapper", () => {
  it("generates run files and native runtime entries idempotently", async () => {
    const root = await workspace();
    await prepareRuntimeWorkspace(root, context);
    const first = await readFile(join(root, "AGENTS.md"), "utf8");
    await prepareRuntimeWorkspace(root, context);
    const second = await readFile(join(root, "AGENTS.md"), "utf8");

    expect(second).toBe(first);
    expect(second.match(new RegExp(HARNESS_MARKER_BEGIN, "g"))).toHaveLength(1);
    expect(second.match(new RegExp(HARNESS_MARKER_END, "g"))).toHaveLength(1);
    await expect(readFile(join(root, ".run/TASK.md"), "utf8")).resolves.toBe("do the task\n");
    await expect(readFile(join(root, ".run/POLICY.json"), "utf8")).resolves.toBe('{\n  "allowedTools": [\n    "read"\n  ]\n}\n');
    await expect(readFile(join(root, "CLAUDE.md"), "utf8")).resolves.toContain(".run/SYSTEM.md");
    await expect(readFile(join(root, "QWEN.md"), "utf8")).resolves.toContain(".run/POLICY.json");
  });

  it("replaces only managed bytes and preserves user content outside markers", async () => {
    const root = await workspace();
    const prefix = "# User instructions\r\nkeep this exactly\r\n\r\n";
    const suffix = "\r\n\r\n## User footer\r\nbyte-stable";
    await writeFile(join(root, "AGENTS.md"), `${prefix}${HARNESS_MARKER_BEGIN}\nold\n${HARNESS_MARKER_END}${suffix}`);

    await prepareRuntimeWorkspace(root, context, ["codex"]);
    const result = await readFile(join(root, "AGENTS.md"), "utf8");
    expect(result.startsWith(prefix)).toBe(true);
    expect(result.endsWith(suffix)).toBe(true);
    expect(result).not.toContain("\nold\n");
  });

  it("rejects traversal, symlink escapes, and malformed managed regions", async () => {
    const root = await workspace();
    await expect(atomicWriteWithinWorkspace(root, "../outside", "no"))
      .rejects.toThrow("workspace_path_outside_root");

    const outside = await workspace();
    await symlink(outside, join(root, ".run"));
    await expect(atomicWriteWithinWorkspace(root, ".run/TASK.md", "no"))
      .rejects.toThrow("workspace_path_symlink");

    const other = await workspace();
    await writeFile(join(other, "AGENTS.md"), `${HARNESS_MARKER_BEGIN}\nbroken`);
    await expect(prepareRuntimeWorkspace(other, context, ["codex"]))
      .rejects.toThrow("workspace_managed_marker_invalid");
  });
});
