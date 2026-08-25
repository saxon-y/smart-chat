import { db } from "@/lib/db";
import { triggerAiForMessage } from "@/lib/ai";

/** In-process MVP boundary. A dedicated worker can consume the same AiRun later. */
export async function triggerAiRun(runId: string): Promise<void> {
  const run = await db.aiRun.findUnique({
    where: { id: runId },
    include: { triggerMessage: { select: { roomId: true } } },
  });
  if (!run) throw new Error("ai_run_not_found");
  await triggerAiForMessage({
    roomId: run.triggerMessage.roomId,
    triggerMessageId: run.triggerMessageId,
    callerMemberId: run.callerMemberId,
    requestId: run.requestId,
  });
}
