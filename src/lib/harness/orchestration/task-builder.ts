import { sha256Digest, taskEnvelopeSchema, type TaskEnvelope } from "../protocol";

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

type ContextBundleInput = Omit<TaskEnvelope["contextBundle"], "digest"> & { digest?: string };
type SkillBundleInput = Omit<TaskEnvelope["skillBundle"], "bundleHash"> & { bundleHash?: string };
type McpBundleInput = Omit<TaskEnvelope["mcpBundle"], "digest"> & { digest?: string };

export type TaskEnvelopeBuildInput = Omit<
  TaskEnvelope,
  "contextBundle" | "skillBundle" | "mcpBundle"
> & {
  contextBundle: ContextBundleInput;
  skillBundle: SkillBundleInput;
  mcpBundle: McpBundleInput;
};

export type TaskBundleDigests = Readonly<{
  context: string;
  skills: string;
  mcp: string;
}>;

export type BuiltTaskEnvelope = Readonly<{
  envelope: DeepReadonly<TaskEnvelope>;
  taskDigest: string;
  bundleDigests: TaskBundleDigests;
}>;

export type CommitReadyTask = (task: BuiltTaskEnvelope) => void | Promise<void>;

function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) deepFreeze(item);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

function assertNoCredentialFields(value: unknown, path = "task"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    const normalized = key.replace(/[-_]/g, "").toLowerCase();
    if (
      normalized === "apikey" ||
      normalized === "authorization" ||
      normalized === "cookie" ||
      normalized === "password" ||
      normalized === "secret" ||
      normalized === "token" ||
      normalized === "ciphertext" ||
      normalized.endsWith("accesstoken") ||
      normalized.endsWith("refreshtoken") ||
      normalized.endsWith("authtoken")
    ) {
      throw new Error(`task_envelope_forbidden_secret_field:${path}.${key}`);
    }
    assertNoCredentialFields(item, `${path}.${key}`);
  }
}

/**
 * Builds the immutable execution snapshot. Callers supply already-authorized,
 * room-scoped data; this function validates and seals it without database I/O.
 */
export function buildTaskEnvelope(input: TaskEnvelopeBuildInput): BuiltTaskEnvelope {
  assertNoCredentialFields(input);

  const contextSnapshot = { ...input.contextBundle };
  const skillSnapshot = { ...input.skillBundle };
  const mcpSnapshot = { ...input.mcpBundle };
  delete contextSnapshot.digest;
  delete skillSnapshot.bundleHash;
  delete mcpSnapshot.digest;

  const bundleDigests: TaskBundleDigests = {
    context: sha256Digest(contextSnapshot),
    skills: sha256Digest(skillSnapshot),
    mcp: sha256Digest(mcpSnapshot),
  };
  const envelope = taskEnvelopeSchema.parse({
    ...input,
    contextBundle: { ...contextSnapshot, digest: bundleDigests.context },
    skillBundle: { ...skillSnapshot, bundleHash: bundleDigests.skills },
    mcpBundle: { ...mcpSnapshot, digest: bundleDigests.mcp },
  });
  const result = {
    envelope,
    taskDigest: sha256Digest(envelope),
    bundleDigests,
  };

  return deepFreeze(result);
}

/**
 * Transaction boundary for orchestration code. The callback must atomically
 * persist the snapshot/digest and transition its run from PREPARING to READY.
 * It is never invoked when construction or validation fails.
 */
export async function buildAndCommitTaskEnvelope(
  input: TaskEnvelopeBuildInput,
  commitReady: CommitReadyTask,
): Promise<BuiltTaskEnvelope> {
  const task = buildTaskEnvelope(input);
  await commitReady(task);
  return task;
}
