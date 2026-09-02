import { AiRunMode, AiRunStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { requireAdmin, AuthError } from "@/lib/auth/guards";
import { errorResponse, json } from "@/lib/http";

export const runtime = "nodejs";

function cursor(value: string | null) {
  if (!value) return null;
  try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return parsed.createdAt && parsed.id ? parsed : null; } catch { return null; }
}
function encode(value: { createdAt: Date; id: string }) { return Buffer.from(JSON.stringify({ createdAt: value.createdAt.toISOString(), id: value.id })).toString("base64url"); }
const date = (value: string | null) => value ? new Date(value) : undefined;

export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const requested = Number(url.searchParams.get("limit") ?? 50);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(100, requested)) : 50;
    const after = cursor(url.searchParams.get("cursor"));
    const status = url.searchParams.get("status") as AiRunStatus | null;
    const mode = url.searchParams.get("mode") as AiRunMode | null;
    const from = date(url.searchParams.get("from"));
    const to = date(url.searchParams.get("to"));
    const metricsWhere = {
      ...(url.searchParams.get("roomId") ? { roomId: url.searchParams.get("roomId")! } : {}),
      ...(url.searchParams.get("agentId") ? { targetAgentId: url.searchParams.get("agentId")! } : {}),
      ...(url.searchParams.get("userId") ? { callerMember: { userId: url.searchParams.get("userId")! } } : {}),
      ...(status && Object.values(AiRunStatus).includes(status) ? { status } : {}),
      ...(mode && Object.values(AiRunMode).includes(mode) ? { mode } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };
    const where = {
      ...metricsWhere,
      ...(after ? { OR: [{ createdAt: { lt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { lt: after.id } }] } : {}),
    };
    const [rows, total, byStatus, byMode] = await Promise.all([
      db.aiRun.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: limit + 1, select: {
        id: true, roomId: true, callerMemberId: true, mode: true, status: true, attempt: true,
        targetAgentId: true, targetMemberId: true, parentRunId: true, runtimeId: true, runtimeKind: true,
        runtimeVersion: true, checkpointSequence: true, contextGeneration: true, decision: true,
        decisionConfidence: true, decisionReasonCode: true, errorCode: true, tokenUsage: true,
        inputTokens: true, outputTokens: true, toolCallCount: true, costMicros: true, latencyMs: true,
        requestId: true, blockedReason: true, createdAt: true, updatedAt: true,
        targetAgent: { select: { id: true, key: true, name: true, kind: true } },
        runtime: { select: { id: true, kind: true, status: true, version: true, lastHeartbeatAt: true } },
        runTurns: { orderBy: { turnIndex: "desc" }, take: 1, select: { turnIndex: true, status: true, thinkingContinuity: true, finishReason: true, usage: true, completedAt: true } },
        runCheckpoints: { orderBy: { eventSequence: "desc" }, take: 1, select: { eventSequence: true, turnIndex: true, contextGeneration: true, createdAt: true } },
        toolCalls: { select: { status: true } }, approvals: { select: {
          id: true, toolCallId: true, argumentsDigest: true, status: true,
          requestedAt: true, decidedAt: true, decidedBy: true, decisionReason: true,
          toolCall: { select: { toolId: true, toolVersion: true, risk: true, status: true } },
        } },
        childRuns: { select: { id: true, status: true, targetAgent: { select: { name: true } } } },
        _count: { select: { runEvents: true, runTurns: true, runCheckpoints: true, artifacts: true, childRuns: true } },
      } }),
      db.aiRun.count({ where: metricsWhere }),
      db.aiRun.groupBy({ by: ["status"], where: metricsWhere, _count: { _all: true } }),
      db.aiRun.groupBy({ by: ["mode"], where: metricsWhere, _count: { _all: true } }),
    ]);
    const hasMore = rows.length > limit;
    const pageRows = rows.slice(0, limit);
    const items = pageRows.map((row) => ({
      ...row, status: row.status.toLowerCase(), mode: row.mode.toLowerCase(),
      latestTurn: row.runTurns[0] ?? null, latestCheckpoint: row.runCheckpoints[0] ?? null,
      toolsByStatus: Object.fromEntries(Object.entries(Object.groupBy(row.toolCalls, (item) => item.status)).map(([key, value]) => [key.toLowerCase(), value?.length ?? 0])),
      approvalsByStatus: Object.fromEntries(Object.entries(Object.groupBy(row.approvals, (item) => item.status)).map(([key, value]) => [key.toLowerCase(), value?.length ?? 0])),
      pendingApprovals: row.approvals.filter((approval) => approval.status === "PENDING"),
      runTurns: undefined, runCheckpoints: undefined, toolCalls: undefined, approvals: undefined,
    }));
    return json({ items, nextCursor: hasMore && pageRows.length ? encode(pageRows[pageRows.length - 1]) : null, metrics: { total, byStatus: Object.fromEntries(byStatus.map((entry) => [entry.status.toLowerCase(), entry._count._all])), byMode: Object.fromEntries(byMode.map((entry) => [entry.mode.toLowerCase(), entry._count._all])) } });
  } catch (error) {
    if (error instanceof AuthError) return errorResponse(error.message, error.status, error.status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN");
    return errorResponse("无法加载 Agent 运行记录", 500, "AGENT_RUN_ERROR");
  }
}
