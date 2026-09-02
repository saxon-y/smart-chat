import { createServer, type Server } from "node:http";
import { Prisma, PrismaClient } from "@prisma/client";

export interface ClaimedRun {
  id: string;
  owner: string;
  leaseGeneration: number;
}

export interface RuntimeWorkerStore {
  registerRuntime(input: { id: string; version: string; now: Date }): Promise<void>;
  claim(input: { runtimeId: string; owner: string; limit: number; leaseMs: number; now: Date }): Promise<ClaimedRun[]>;
  heartbeat(input: { runtimeId: string; run: ClaimedRun; leaseMs: number; now: Date }): Promise<"ACTIVE" | "CANCEL" | "LEASE_LOST">;
  finishRuntime(input: { id: string; now: Date }): Promise<void>;
}

export interface RuntimeWorkerOptions {
  runtimeId: string;
  version: string;
  concurrency: number;
  scanIntervalMs: number;
  leaseMs: number;
  heartbeatMs: number;
  inactivityTimeoutMs: number;
  maxRunTimeMs: number;
  now?: () => Date;
}

export type ClaimedRunExecutor = (run: ClaimedRun, context: {
  signal: AbortSignal;
  activity(): void;
}) => Promise<void>;

const delay = (milliseconds: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const timer = setTimeout(resolve, milliseconds);
  signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
});

export class SelfHostedRuntimeWorker {
  private readonly controller = new AbortController();
  private readonly active = new Map<string, Promise<void>>();
  private accepting = true;
  private started = false;
  private scanning = false;

  constructor(
    private readonly store: RuntimeWorkerStore,
    private readonly execute: ClaimedRunExecutor,
    private readonly options: RuntimeWorkerOptions,
  ) {}

  get health() {
    return { live: this.started && !this.controller.signal.aborted, ready: this.started && this.accepting, active: this.active.size };
  }

  notify() {
    // Notifications are only a latency optimization. The bounded scan loop is authoritative.
    void this.scan();
  }

  async start() {
    if (this.started) throw new Error("runtime_worker_already_started");
    this.started = true;
    this.accepting = true;
    await this.store.registerRuntime({ id: this.options.runtimeId, version: this.options.version, now: this.now() });
    while (!this.controller.signal.aborted) {
      await this.scan();
      await delay(this.options.scanIntervalMs, this.controller.signal);
    }
    await Promise.allSettled(this.active.values());
    await this.store.finishRuntime({ id: this.options.runtimeId, now: this.now() });
  }

  async scan() {
    if (!this.accepting || this.scanning) return 0;
    this.scanning = true;
    try {
      const capacity = Math.max(0, this.options.concurrency - this.active.size);
      if (!capacity) return 0;
      const owner = `${this.options.runtimeId}:${process.pid}`;
      const runs = await this.store.claim({ runtimeId: this.options.runtimeId, owner, limit: capacity, leaseMs: this.options.leaseMs, now: this.now() });
      for (const run of runs) {
        const execution = this.runClaim(run).finally(() => this.active.delete(run.id));
        this.active.set(run.id, execution);
      }
      return runs.length;
    } finally {
      this.scanning = false;
    }
  }

  async stop() {
    this.accepting = false;
    this.controller.abort(new Error("runtime_worker_shutdown"));
    await Promise.allSettled(this.active.values());
  }

  private now() { return (this.options.now ?? (() => new Date()))(); }

  private async runClaim(run: ClaimedRun) {
    const controller = new AbortController();
    let lastActivity = this.now().getTime();
    const startedAt = lastActivity;
    const abort = (reason: string) => { if (!controller.signal.aborted) controller.abort(new Error(reason)); };
    const watchdog = setInterval(async () => {
      const now = this.now();
      if (now.getTime() - startedAt >= this.options.maxRunTimeMs) return abort("run_wall_time_exceeded");
      if (now.getTime() - lastActivity >= this.options.inactivityTimeoutMs) return abort("run_inactivity_timeout");
      try {
        const status = await this.store.heartbeat({ runtimeId: this.options.runtimeId, run, leaseMs: this.options.leaseMs, now });
        if (status === "CANCEL") abort("run_cancelled");
        if (status === "LEASE_LOST") abort("run_lease_lost");
      } catch {
        // A failed renewal cannot grant authority. Abort before the current lease can expire.
        abort("run_lease_heartbeat_failed");
      }
    }, this.options.heartbeatMs);
    try {
      await this.execute(run, { signal: controller.signal, activity: () => { lastActivity = this.now().getTime(); } });
    } finally {
      clearInterval(watchdog);
    }
  }
}

export class PrismaRuntimeWorkerStore implements RuntimeWorkerStore {
  constructor(private readonly client = new PrismaClient()) {}

  registerRuntime({ id, version, now }: { id: string; version: string; now: Date }) {
    return this.client.agentRuntime.upsert({
      where: { id },
      create: { id, kind: "self-hosted", version, capabilities: ["text", "image", "supervisor"], status: "READY", lastHeartbeatAt: now },
      update: { version, status: "READY", lastHeartbeatAt: now },
    }).then(() => undefined);
  }

  async claim({ runtimeId, owner, limit, leaseMs, now }: { runtimeId: string; owner: string; limit: number; leaseMs: number; now: Date }) {
    if (limit <= 0) return [];
    return this.client.$transaction(async (tx) => {
      const candidates = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT "id" FROM "AiRun"
        WHERE "runtimeId" = ${runtimeId}
          AND "cancelRequestedAt" IS NULL
          AND (
            "status" IN ('PENDING', 'READY')
            OR ("status" = 'FAILED_RETRYABLE' AND "nextRetryAt" <= ${now})
            OR ("status" IN ('CLAIMED', 'RUNNING') AND "leaseExpiresAt" < ${now})
          )
        ORDER BY "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      `);
      const claimed: ClaimedRun[] = [];
      for (const candidate of candidates) {
        const run = await tx.aiRun.update({
          where: { id: candidate.id },
          data: { status: "CLAIMED", owner, leaseGeneration: { increment: 1 }, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempt: { increment: 1 } },
          select: { id: true, owner: true, leaseGeneration: true },
        });
        claimed.push({ id: run.id, owner: run.owner!, leaseGeneration: run.leaseGeneration });
      }
      return claimed;
    });
  }

  async heartbeat({ runtimeId, run, leaseMs, now }: { runtimeId: string; run: ClaimedRun; leaseMs: number; now: Date }) {
    const current = await this.client.aiRun.findUnique({ where: { id: run.id }, select: { runtimeId: true, owner: true, leaseGeneration: true, cancelRequestedAt: true, status: true } });
    if (!current || current.runtimeId !== runtimeId || current.owner !== run.owner || current.leaseGeneration !== run.leaseGeneration || !["CLAIMED", "RUNNING"].includes(current.status)) return "LEASE_LOST" as const;
    if (current.cancelRequestedAt) return "CANCEL" as const;
    const renewed = await this.client.aiRun.updateMany({
      where: { id: run.id, runtimeId, owner: run.owner, leaseGeneration: run.leaseGeneration, cancelRequestedAt: null, status: { in: ["CLAIMED", "RUNNING"] } },
      data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    await this.client.agentRuntime.updateMany({ where: { id: runtimeId }, data: { status: "READY", lastHeartbeatAt: now } });
    return renewed.count === 1 ? "ACTIVE" as const : "LEASE_LOST" as const;
  }

  finishRuntime({ id, now }: { id: string; now: Date }) {
    return this.client.agentRuntime.updateMany({ where: { id }, data: { status: "STOPPED", lastHeartbeatAt: now } }).then(() => undefined);
  }
}

export function createHealthServer(worker: SelfHostedRuntimeWorker, port: number): Server {
  return createServer((request, response) => {
    const health = worker.health;
    if (request.url === "/live") {
      response.writeHead(health.live ? 200 : 503, { "content-type": "application/json" });
      return response.end(JSON.stringify(health));
    }
    if (request.url === "/ready") {
      response.writeHead(health.ready ? 200 : 503, { "content-type": "application/json" });
      return response.end(JSON.stringify(health));
    }
    response.writeHead(404).end();
  }).listen(port);
}
