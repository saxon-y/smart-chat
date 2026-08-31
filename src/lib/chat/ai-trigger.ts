import { processAiRun, recoverPendingAiRuns } from "@/lib/ai/service";

let recoveryStarted = false;

function startRecoveryLoop() {
  if (recoveryStarted || process.env.NODE_ENV === "test" || process.env.NODE_ENV === "production") return;
  recoveryStarted = true;
  const timer = setInterval(() => { void recoverPendingAiRuns().catch(() => undefined); }, 5000);
  timer.unref();
}

export async function triggerAiRun(runId: string): Promise<void> {
  startRecoveryLoop();
  await processAiRun(runId);
}

export function ensureAiWorker() {
  if (process.env.NODE_ENV === "production") return;
  startRecoveryLoop();
  void recoverPendingAiRuns().catch(() => undefined);
}
