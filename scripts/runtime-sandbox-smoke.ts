import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSandboxSpec } from "../src/lib/harness/runtime/sandbox/spec.ts";

const image = process.env.CODE_RUNTIME_IMAGE ?? "alpine:3.20";
const root = mkdtempSync(join(tmpdir(), "smart-chat-sandbox-smoke-"));
const runId = "smoke-run";
const spec = createSandboxSpec({ image, command: ["/bin/sh"], runId, workspaceRoot: root });
mkdirSync(spec.workspace.hostPath, { recursive: true });

const command = [
  "set -eu",
  "test \"$(id -u)\" = \"65532\"",
  "touch /workspace/smoke.txt",
  "test -f /workspace/smoke.txt",
  "if touch /tmp/smoke.txt 2>/dev/null; then exit 21; fi",
  "if touch /root/smoke.txt 2>/dev/null; then exit 20; fi",
  "test \"$(wc -l < /proc/net/route)\" -eq 1",
  "test ! -e /var/run/docker.sock",
  "printf 'uid=%s workspace=ok root_read_only=ok network=none docker_socket=absent\\n' \"$(id -u)\"",
].join("; ");

const args = [
  "run",
  "--rm",
  "--user",
  spec.user,
  "--read-only",
  "--network",
  "none",
  "--security-opt",
  "no-new-privileges:true",
  "--cap-drop",
  "ALL",
  "--cpus",
  String(spec.resources.cpuCount),
  "--memory",
  String(spec.resources.memoryBytes),
  "--pids-limit",
  String(spec.resources.pids),
  "--mount",
  `type=bind,src=${spec.workspace.hostPath},dst=${spec.workspace.containerPath}`,
  "--workdir",
  spec.workspace.containerPath,
  spec.image,
  ...spec.command,
  "-c",
  command,
];

try {
  const output = execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  assert.match(output, /uid=65532/);
  assert.match(output, /workspace=ok/);
  assert.match(output, /root_read_only=ok/);
  assert.match(output, /network=none/);
  assert.match(output, /docker_socket=absent/);
  process.stdout.write(`${JSON.stringify({ result: "PASS", image: spec.image, user: spec.user, network: spec.network, resources: spec.resources, checks: ["non-root", "read-only-root", "workspace-write", "network-disabled", "no-docker-socket"] })}\n`);
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  process.stderr.write(`CODE_RUNTIME sandbox smoke failed: ${detail}\n`);
  process.exitCode = 1;
} finally {
  rmSync(root, { recursive: true, force: true });
}
