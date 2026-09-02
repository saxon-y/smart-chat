import { sha256Digest } from "../protocol/canonical";
import type { ToolDefinition, ToolDisclosure, ToolExecutionContext, RegisteredTool } from "./types";

const TOOL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const TOOL_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export class ToolRegistryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ToolRegistryError";
  }
}

function toolKey(id: string, version: string) {
  return `${id}@${version}`;
}

function serializedByteLength(value: unknown) {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new ToolRegistryError("tool_result_not_serializable");
  }
  if (serialized === undefined) throw new ToolRegistryError("tool_result_not_serializable");
  return Buffer.byteLength(serialized, "utf8");
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isJsonValue);
  }
  return false;
}

export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register<TInput, TResult>(definition: ToolDefinition<TInput, TResult>): RegisteredTool<TInput, TResult> {
    if (!TOOL_ID_PATTERN.test(definition.id)) throw new ToolRegistryError("tool_id_invalid");
    if (!TOOL_VERSION_PATTERN.test(definition.version)) throw new ToolRegistryError("tool_version_invalid");
    if (definition.timeoutMs <= 0 || !Number.isSafeInteger(definition.timeoutMs)) throw new ToolRegistryError("tool_timeout_invalid");
    if (definition.maxResultBytes <= 0 || !Number.isSafeInteger(definition.maxResultBytes)) throw new ToolRegistryError("tool_result_limit_invalid");
    if (!definition.inputSchema || typeof definition.inputSchema.safeParse !== "function") throw new ToolRegistryError("tool_schema_invalid");
    if (!definition.inputSchemaDocument || Array.isArray(definition.inputSchemaDocument) || !isJsonValue(definition.inputSchemaDocument)) {
      throw new ToolRegistryError("tool_schema_invalid");
    }
    if (definition.risk !== "READ" && definition.concurrency === "isolated") throw new ToolRegistryError("tool_write_concurrency_invalid");

    const key = toolKey(definition.id, definition.version);
    if (this.tools.has(key)) throw new ToolRegistryError("tool_already_registered");
    const registered: RegisteredTool<TInput, TResult> = Object.freeze({
      ...definition,
      concurrency: definition.concurrency ?? "forbidden",
      requiredCapabilities: Object.freeze([...(definition.requiredCapabilities ?? [])]),
      inputSchemaDocument: Object.freeze({ ...definition.inputSchemaDocument }),
      schemaDigest: sha256Digest(definition.inputSchemaDocument),
    });
    this.tools.set(key, registered as RegisteredTool);
    return registered;
  }

  resolve(id: string, version: string, expectedSchemaDigest?: string): RegisteredTool {
    const tool = this.tools.get(toolKey(id, version));
    if (!tool) {
      const versionExists = [...this.tools.values()].some((candidate) => candidate.id === id);
      throw new ToolRegistryError(versionExists ? "tool_version_mismatch" : "tool_not_registered");
    }
    if (expectedSchemaDigest && expectedSchemaDigest !== tool.schemaDigest) throw new ToolRegistryError("tool_schema_digest_mismatch");
    return tool;
  }

  disclose(mode: "index" | "full", allowedTools?: ReadonlySet<string>): ToolDisclosure[] {
    return [...this.tools.values()]
      .filter((tool) => !allowedTools || allowedTools.has(tool.id))
      .sort((left, right) => toolKey(left.id, left.version).localeCompare(toolKey(right.id, right.version)))
      .map((tool) => ({
        id: tool.id,
        version: tool.version,
        description: tool.description,
        risk: tool.risk,
        schemaDigest: tool.schemaDigest,
        ...(mode === "full" ? { inputSchema: tool.inputSchemaDocument } : {}),
      }));
  }

  async execute(id: string, version: string, rawInput: unknown, context: Omit<ToolExecutionContext, "signal">): Promise<unknown> {
    const tool = this.resolve(id, version);
    const parsed = tool.inputSchema.safeParse(rawInput);
    if (!parsed.success) throw new ToolRegistryError("tool_arguments_invalid");
    if (tool.idempotency === "KEYED" && !context.idempotencyKey) throw new ToolRegistryError("tool_idempotency_key_required");

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ToolRegistryError("tool_timeout"));
      }, tool.timeoutMs);
    });
    try {
      const result = await Promise.race([tool.execute(parsed.data, { ...context, signal: controller.signal }), timeout]);
      if (serializedByteLength(result) > tool.maxResultBytes) throw new ToolRegistryError("tool_result_too_large");
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
