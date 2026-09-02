export interface DeltaBatch {
  text: string;
  byteLength: number;
}

export type DeltaSink = (batch: DeltaBatch) => void | Promise<void>;

export interface DeltaAggregatorOptions {
  maxBytes?: number;
  maxDelayMs?: number;
}

/** Batches model deltas without altering their order or contents. */
export class DeltaAggregator {
  private buffer = "";
  private bytes = 0;
  private bufferedAt: number | undefined;

  readonly maxBytes: number;
  readonly maxDelayMs: number;

  constructor(private readonly sink: DeltaSink, options: DeltaAggregatorOptions = {}) {
    this.maxBytes = options.maxBytes ?? 4 * 1024;
    this.maxDelayMs = options.maxDelayMs ?? 200;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0) throw new Error("delta_max_bytes_invalid");
    if (!Number.isSafeInteger(this.maxDelayMs) || this.maxDelayMs < 100 || this.maxDelayMs > 250) {
      throw new Error("delta_max_delay_invalid");
    }
  }

  async push(text: string, now = Date.now()): Promise<void> {
    if (!text) return;
    if (this.bufferedAt === undefined) this.bufferedAt = now;
    this.buffer += text;
    this.bytes += Buffer.byteLength(text, "utf8");
    if (this.bytes >= this.maxBytes || now - this.bufferedAt >= this.maxDelayMs) await this.flush();
  }

  async flush(): Promise<void> {
    if (!this.buffer) return;
    const batch = { text: this.buffer, byteLength: this.bytes };
    this.buffer = "";
    this.bytes = 0;
    this.bufferedAt = undefined;
    await this.sink(batch);
  }

  discard(): void {
    this.buffer = "";
    this.bytes = 0;
    this.bufferedAt = undefined;
  }
}
