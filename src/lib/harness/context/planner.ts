import { HarnessRuntimeError, sha256Digest, type ArtifactRef } from "../protocol";
import type {
  ContextPlan,
  ContextPlanInput,
  ContextPlannerOptions,
  PlannerContextBlock,
} from "./types";

const kindOrder: Record<PlannerContextBlock["kind"], number> = {
  policy: 0,
  agent: 1,
  task: 2,
  skill: 3,
  message: 4,
  memory: 5,
  artifact: 6,
  "tool-result": 7,
  handoff: 8,
};

const originOrder: Record<PlannerContextBlock["origin"], number> = {
  system_policy: 0,
  user: 1,
  skill: 2,
  tool: 3,
  mcp: 4,
  child_handoff: 5,
  memory: 6,
  retrieval: 7,
};

export function hasInstructionAuthority(block: PlannerContextBlock) {
  return block.origin === "system_policy" || block.kind === "task" && block.origin === "user";
}

export function isProtectedContextBlock(block: PlannerContextBlock) {
  return block.pinned === true || block.kind === "policy" || block.kind === "task" || block.kind === "skill";
}

export function compareContextBlocks(left: PlannerContextBlock, right: PlannerContextBlock) {
  return kindOrder[left.kind] - kindOrder[right.kind]
    || originOrder[left.origin] - originOrder[right.origin]
    || right.priority - left.priority
    || left.id.localeCompare(right.id);
}

function contextBudgetError() {
  return new HarnessRuntimeError(
    "context_budget_exceeded",
    "CONTEXT",
    false,
    true,
    "FULL",
    "上下文超过预算",
  );
}

function totalTokens(blocks: readonly PlannerContextBlock[]) {
  return blocks.reduce((total, block) => total + block.tokenEstimate, 0);
}

function pairGroup(block: PlannerContextBlock) {
  return block.toolPairKey ? `tool:${block.toolPairKey}` : `block:${block.id}`;
}

function pruneToBudget(blocks: readonly PlannerContextBlock[], budget: number) {
  const retained = new Set(blocks.map((block) => block.id));
  let tokens = totalTokens(blocks);
  const groups = new Map<string, PlannerContextBlock[]>();

  for (const block of blocks) {
    const key = pairGroup(block);
    groups.set(key, [...(groups.get(key) ?? []), block]);
  }

  const removable = [...groups.values()]
    .filter((group) => group.every((block) => !isProtectedContextBlock(block)))
    .sort((left, right) => {
      const leftPriority = Math.max(...left.map((block) => block.priority));
      const rightPriority = Math.max(...right.map((block) => block.priority));
      return leftPriority - rightPriority
        || Math.max(...right.map((block) => kindOrder[block.kind])) - Math.max(...left.map((block) => kindOrder[block.kind]))
        || pairGroup(left[0]).localeCompare(pairGroup(right[0]));
    });

  for (const group of removable) {
    if (tokens <= budget) break;
    for (const block of group) {
      retained.delete(block.id);
      tokens -= block.tokenEstimate;
    }
  }

  return blocks.filter((block) => retained.has(block.id));
}

async function externalizeLargeResults(
  blocks: readonly PlannerContextBlock[],
  options: ContextPlannerOptions,
) {
  const artifacts: ArtifactRef[] = [];
  const threshold = options.externalizeAboveTokens ?? Number.POSITIVE_INFINITY;
  const output: PlannerContextBlock[] = [];

  for (const block of blocks) {
    if (block.kind !== "tool-result" || block.tokenEstimate <= threshold || !options.externalizer) {
      output.push(block);
      continue;
    }
    const artifact = await options.externalizer.externalize(block);
    artifacts.push(artifact);
    output.push({
      ...block,
      content: `[artifact:${artifact.id}]`,
      sourceRef: `artifact:${artifact.id}`,
      tokenEstimate: 8,
    });
  }
  return { blocks: output, artifacts };
}

export async function buildContextBundle(
  input: ContextPlanInput,
  options: ContextPlannerOptions,
): Promise<ContextPlan> {
  if (!Number.isInteger(options.budget) || options.budget < 0) throw new RangeError("context_budget_invalid");
  const eligible = input.blocks.filter((block) => !options.currentRoomId || !block.roomId || block.roomId === options.currentRoomId);
  const unique = new Map<string, PlannerContextBlock>();
  for (const block of eligible) {
    if (unique.has(block.id)) throw new Error(`context_block_duplicate:${block.id}`);
    unique.set(block.id, block);
  }

  const externalized = await externalizeLargeResults([...unique.values()].sort(compareContextBlocks), options);
  let blocks = externalized.blocks;
  const decisions: Array<Record<string, unknown>> = [];
  if (externalized.artifacts.length) decisions.push({ type: "externalized", artifactIds: externalized.artifacts.map(({ id }) => id) });

  const maxAttempts = Math.min(3, Math.max(0, options.maxCompressionAttempts ?? 3));
  for (let attempt = 1; totalTokens(blocks) > options.budget && options.compression && attempt <= maxAttempts; attempt += 1) {
    const compressed = await options.compression.compress({
      blocks,
      attempt,
      budget: options.budget,
      tokenEstimate: totalTokens(blocks),
    });
    const byId = new Map(compressed.map((block) => [block.id, block]));
    for (const block of blocks) {
      const next = byId.get(block.id);
      if (!next) throw new Error(`compression_removed_block:${block.id}`);
      if (isProtectedContextBlock(block) && (next.content !== block.content || next.tokenEstimate !== block.tokenEstimate)) {
        throw new Error(`compression_modified_protected_block:${block.id}`);
      }
    }
    if (byId.size !== blocks.length) throw new Error("compression_changed_block_set");
    blocks = [...byId.values()].sort(compareContextBlocks);
    decisions.push({ type: "compressed", attempt });
  }

  blocks = pruneToBudget(blocks, options.budget);
  const retainedIds = new Set(blocks.map((block) => block.id));
  const prunedIds = externalized.blocks.filter((block) => !retainedIds.has(block.id)).map((block) => block.id);
  if (prunedIds.length) decisions.push({ type: "pruned", blockIds: prunedIds });

  blocks = [...blocks].sort(compareContextBlocks);
  const tokenEstimate = totalTokens(blocks);
  if (tokenEstimate > options.budget) throw contextBudgetError();
  const bundleBlocks = blocks.map((block) => {
    const bundleBlock = { ...block };
    delete bundleBlock.toolPairKey;
    delete bundleBlock.roomId;
    return bundleBlock;
  });
  const digest = sha256Digest({
    generation: options.generation ?? 0,
    objective: input.objective,
    blocks: bundleBlocks,
    referencedArtifacts: externalized.artifacts,
    unresolved: [...(input.unresolved ?? [])],
  });

  return {
    generation: options.generation ?? 0,
    objective: input.objective,
    blocks: bundleBlocks,
    referencedArtifacts: externalized.artifacts,
    decisions,
    unresolved: [...(input.unresolved ?? [])],
    digest,
    tokenEstimate,
  };
}
