export type ConcurrencyPolicy = {
  global: number;
  perRoom: number;
  perUser: number;
  perAgent: number;
  perProvider: number;
  perRuntime: number;
  perMcpServer: number;
  supervisorPerRoom?: number;
  maxQueue?: number;
};

export type QuotaRequest = {
  roomId: string;
  userId: string;
  agentId: string;
  providerId: string;
  runtimeId: string;
  mcpServerIds?: readonly string[];
  supervisor?: boolean;
};

export interface QuotaLease {
  release(): void;
}

export interface QuotaCoordinator {
  tryAcquire(request: QuotaRequest): QuotaLease | undefined;
  acquire(request: QuotaRequest, signal?: AbortSignal): Promise<QuotaLease>;
  snapshot(): ReadonlyMap<string, number>;
}

type Claim = { key: string; limit: number };
type Waiter = {
  claims: Claim[];
  resolve: (lease: QuotaLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abort?: () => void;
};

function positiveInteger(value: number, name: string) {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`quota_invalid_limit:${name}`);
}

export class InMemoryQuotaCoordinator implements QuotaCoordinator {
  private readonly usage = new Map<string, number>();
  private readonly queue: Waiter[] = [];

  constructor(private readonly policy: ConcurrencyPolicy) {
    for (const [name, value] of Object.entries(policy)) {
      if (value !== undefined) positiveInteger(value, name);
    }
  }

  tryAcquire(request: QuotaRequest): QuotaLease | undefined {
    const claims = this.claimsFor(request);
    if (!this.available(claims)) return undefined;
    return this.claim(claims);
  }

  acquire(request: QuotaRequest, signal?: AbortSignal): Promise<QuotaLease> {
    if (signal?.aborted) return Promise.reject(new Error("quota_acquire_aborted"));
    const immediate = this.tryAcquire(request);
    if (immediate) return Promise.resolve(immediate);
    if (this.queue.length >= (this.policy.maxQueue ?? 1_000)) return Promise.reject(new Error("quota_queue_full"));

    return new Promise((resolve, reject) => {
      const waiter: Waiter = { claims: this.claimsFor(request), resolve, reject, signal };
      waiter.abort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new Error("quota_acquire_aborted"));
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.queue.push(waiter);
    });
  }

  snapshot(): ReadonlyMap<string, number> {
    return new Map(this.usage);
  }

  private claimsFor(request: QuotaRequest): Claim[] {
    const claims: Claim[] = [
      { key: "global", limit: this.policy.global },
      { key: `room:${request.roomId}`, limit: this.policy.perRoom },
      { key: `user:${request.userId}`, limit: this.policy.perUser },
      { key: `agent:${request.agentId}`, limit: this.policy.perAgent },
      { key: `provider:${request.providerId}`, limit: this.policy.perProvider },
      { key: `runtime:${request.runtimeId}`, limit: this.policy.perRuntime },
      ...new Set(request.mcpServerIds ?? []).values().map((id) => ({ key: `mcp:${id}`, limit: this.policy.perMcpServer })),
    ];
    if (request.supervisor) claims.push({ key: `supervisor-room:${request.roomId}`, limit: this.policy.supervisorPerRoom ?? 1 });
    return claims;
  }

  private available(claims: readonly Claim[]) {
    return claims.every(({ key, limit }) => (this.usage.get(key) ?? 0) < limit);
  }

  private claim(claims: readonly Claim[]): QuotaLease {
    for (const { key } of claims) this.usage.set(key, (this.usage.get(key) ?? 0) + 1);
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        for (const { key } of claims) {
          const next = (this.usage.get(key) ?? 0) - 1;
          if (next > 0) this.usage.set(key, next);
          else this.usage.delete(key);
        }
        this.drain();
      },
    };
  }

  private drain() {
    for (let index = 0; index < this.queue.length;) {
      const waiter = this.queue[index];
      if (waiter.signal?.aborted) {
        this.queue.splice(index, 1);
        continue;
      }
      if (!this.available(waiter.claims)) {
        index += 1;
        continue;
      }
      this.queue.splice(index, 1);
      if (waiter.abort) waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.resolve(this.claim(waiter.claims));
    }
  }
}
