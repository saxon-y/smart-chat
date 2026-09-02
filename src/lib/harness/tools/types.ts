import type { z } from "zod";

export type ToolRisk = "READ" | "WRITE" | "DESTRUCTIVE";
export type ToolIdempotency = "READ_ONLY" | "KEYED" | "NON_IDEMPOTENT";
export type ToolConcurrency = "forbidden" | "isolated";
export type ToolCategory = "perception" | "action" | "collaboration" | "event-trigger" | "user-communication";

export interface ToolExecutionContext {
  runId: string;
  toolCallId: string;
  idempotencyKey?: string;
  signal: AbortSignal;
}

export interface ToolDefinition<TInput = unknown, TResult = unknown> {
  id: string;
  version: string;
  description: string;
  category: ToolCategory;
  inputSchema: z.ZodType<TInput>;
  /** JSON-serializable schema snapshot used for disclosure and digest pinning. */
  inputSchemaDocument: Readonly<Record<string, unknown>>;
  risk: ToolRisk;
  idempotency: ToolIdempotency;
  concurrency?: ToolConcurrency;
  timeoutMs: number;
  maxResultBytes: number;
  requiredCapabilities?: readonly string[];
  execute(input: TInput, context: ToolExecutionContext): Promise<TResult>;
}

export interface RegisteredTool<TInput = unknown, TResult = unknown>
  extends Omit<ToolDefinition<TInput, TResult>, "concurrency" | "requiredCapabilities"> {
  schemaDigest: string;
  concurrency: ToolConcurrency;
  requiredCapabilities: readonly string[];
}

export interface ToolIndexEntry {
  id: string;
  version: string;
  description: string;
  risk: ToolRisk;
  schemaDigest: string;
}

export type ToolDisclosure = ToolIndexEntry & { inputSchema?: Readonly<Record<string, unknown>> };
