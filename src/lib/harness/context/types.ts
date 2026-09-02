import type { ArtifactRef, ContextBlock, ContextBundle } from "../protocol";

export type PlannerContextBlock = ContextBlock & {
  /** A call and its result share this key and are retained or removed together. */
  toolPairKey?: string;
  roomId?: string;
};

export type ContextCompressionRequest = {
  blocks: readonly PlannerContextBlock[];
  attempt: number;
  budget: number;
  tokenEstimate: number;
};

export interface ContextCompressionStrategy {
  compress(request: ContextCompressionRequest): Promise<readonly PlannerContextBlock[]> | readonly PlannerContextBlock[];
}

export interface ContextArtifactExternalizer {
  externalize(block: PlannerContextBlock): Promise<ArtifactRef> | ArtifactRef;
}

export type ContextPlannerOptions = {
  budget: number;
  generation?: number;
  currentRoomId?: string;
  maxCompressionAttempts?: number;
  externalizeAboveTokens?: number;
  compression?: ContextCompressionStrategy;
  externalizer?: ContextArtifactExternalizer;
};

export type ContextPlanInput = {
  objective: string;
  blocks: readonly PlannerContextBlock[];
  unresolved?: readonly string[];
};

export type ContextPlan = ContextBundle & {
  tokenEstimate: number;
};
