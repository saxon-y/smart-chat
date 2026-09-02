import { pathToFileURL } from "node:url";
import { createHealthServer, PrismaRuntimeWorkerStore, SelfHostedRuntimeWorker, type ClaimedRunExecutor } from "../runtime/self-hosted-worker.ts";

function positiveInteger(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`invalid_${name.toLowerCase()}`);
  return value;
}

async function loadExecutor(): Promise<ClaimedRunExecutor> {
  const modulePath = process.env.SELF_HOSTED_RUNTIME_EXECUTOR;
  if (!modulePath) throw new Error("SELF_HOSTED_RUNTIME_EXECUTOR is required until self-hosted routing is enabled");
  const imported = await import(pathToFileURL(modulePath).href) as { executeClaimedRun?: ClaimedRunExecutor };
  if (typeof imported.executeClaimedRun !== "function") throw new Error("runtime executor must export executeClaimedRun");
  return imported.executeClaimedRun;
}

async function main() {
  const execute = await loadExecutor();
  const worker = new SelfHostedRuntimeWorker(new PrismaRuntimeWorkerStore(), execute, {
    runtimeId: process.env.SELF_HOSTED_RUNTIME_ID ?? "self-hosted-local",
    version: process.env.npm_package_version ?? "dev",
    concurrency: positiveInteger("SELF_HOSTED_RUNTIME_CONCURRENCY", 4),
    scanIntervalMs: positiveInteger("SELF_HOSTED_RUNTIME_SCAN_INTERVAL_MS", 1000),
    leaseMs: positiveInteger("SELF_HOSTED_RUNTIME_LEASE_MS", 30_000),
    heartbeatMs: positiveInteger("SELF_HOSTED_RUNTIME_HEARTBEAT_MS", 5_000),
    inactivityTimeoutMs: positiveInteger("SELF_HOSTED_RUNTIME_INACTIVITY_TIMEOUT_MS", 120_000),
    maxRunTimeMs: positiveInteger("SELF_HOSTED_RUNTIME_MAX_RUN_TIME_MS", 900_000),
  });
  const health = createHealthServer(worker, positiveInteger("SELF_HOSTED_RUNTIME_HEALTH_PORT", 3011));
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    health.close();
    await worker.stop();
  };
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
  await worker.start();
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exitCode = 1;
});
