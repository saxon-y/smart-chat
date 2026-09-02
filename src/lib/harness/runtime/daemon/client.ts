import { verifyTaskCredential } from "./credential";
import type { DaemonControlPlaneTransport, DaemonLease, DaemonRegistration, DaemonTask, WakeConnector } from "./types";

export class DaemonClient {
  private lease?: DaemonLease;
  private wakePending = false;
  private wakeWaiter?: () => void;

  constructor(
    readonly registration: DaemonRegistration,
    private readonly transport: DaemonControlPlaneTransport,
    private readonly credentialSecret: string,
    private readonly options: { now?: () => number; heartbeatTimeoutMs?: number } = {},
  ) {}

  async register() {
    const lease = await this.transport.register({ ...this.registration, capabilities: [...this.registration.capabilities] });
    if (lease.daemonId !== this.registration.daemonId) throw new Error("daemon_lease_subject_mismatch");
    this.lease = lease;
    return this.lease;
  }

  async heartbeat() {
    const lease = await this.transport.heartbeat(this.registration.daemonId);
    if (lease.daemonId !== this.registration.daemonId) throw new Error("daemon_lease_subject_mismatch");
    this.lease = lease;
    return this.lease;
  }

  isHealthy() {
    const now = (this.options.now ?? Date.now)();
    const timeout = this.options.heartbeatTimeoutMs ?? 30_000;
    return !!this.lease && this.lease.expiresAt > now && now - this.lease.lastHeartbeatAt <= timeout;
  }

  async claim(): Promise<DaemonTask | null> {
    if (!this.isHealthy()) return null;
    const task = await this.transport.claim(this.registration.daemonId);
    if (!task) return null;
    const registered = new Set(this.registration.capabilities);
    if (task.requiredCapabilities.some((capability) => !registered.has(capability))) return null;
    verifyTaskCredential(task.credential, this.credentialSecret, {
      runId: task.runId,
      daemonId: this.registration.daemonId,
      capabilities: task.requiredCapabilities,
    }, (this.options.now ?? Date.now)());
    return task;
  }

  /** WebSocket is only a wake hint. Claims always go through the control-plane transport. */
  async *watch(connector: WakeConnector, options: { pollIntervalMs?: number; signal?: AbortSignal } = {}): AsyncGenerator<DaemonTask> {
    const pollIntervalMs = options.pollIntervalMs ?? 5_000;
    let connection: Awaited<ReturnType<WakeConnector["connect"]>> | undefined;
    try {
      connection = await connector.connect(this.registration.daemonId, () => {
        this.wakePending = true;
        this.wakeWaiter?.();
      }).catch(() => undefined);
      connection?.closed.then(() => { connection = undefined; }).catch(() => { connection = undefined; });
      while (!options.signal?.aborted) {
        if (this.wakePending || !connection) {
          this.wakePending = false;
          const task = await this.claim();
          if (task) yield task;
        }
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timer);
            this.wakeWaiter = undefined;
            resolve();
          };
          const timer = setTimeout(finish, pollIntervalMs);
          this.wakeWaiter = finish;
          options.signal?.addEventListener("abort", finish, { once: true });
        });
        // Poll periodically even while wake notifications are connected; notifications are lossy by design.
        const task = await this.claim();
        if (task) yield task;
      }
    } finally {
      connection?.close();
    }
  }
}
