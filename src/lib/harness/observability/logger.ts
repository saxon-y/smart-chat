export type LogLevel = "debug" | "info" | "warn" | "error";

export interface CorrelationFields {
  runId?: string;
  parentRunId?: string;
  roomId?: string;
  runtimeId?: string;
  turnIndex?: number;
  toolCallId?: string;
  leaseGeneration?: number;
  requestId?: string;
}

export interface StructuredLogEntry extends CorrelationFields {
  timestamp: string;
  level: LogLevel;
  event: string;
  fields?: unknown;
}

const SENSITIVE_KEY = /^(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|private[-_]?key)$/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const SECRET_VALUE = /\b(sk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi;
const REDACTED = "[REDACTED]";

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return value.replace(BEARER, `Bearer ${REDACTED}`).replace(SECRET_VALUE, REDACTED);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  if (value instanceof Error) return { name: value.name, message: redact(value.message), stack: redact(value.stack) };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : redact(item, seen)]));
}

export type LogSink = (entry: StructuredLogEntry) => void;

export class StructuredLogger {
  constructor(private readonly sink: LogSink = (entry) => process.stdout.write(`${JSON.stringify(entry)}\n`)) {}

  log(level: LogLevel, event: string, correlation: CorrelationFields = {}, fields?: unknown) {
    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      event,
      ...correlation,
      ...(fields === undefined ? {} : { fields: redact(fields) }),
    };
    this.sink(entry);
    return entry;
  }
}
