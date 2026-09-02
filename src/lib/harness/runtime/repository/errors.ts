export class LeaseLostError extends Error {
  readonly code = "LEASE_LOST";
  constructor(runId: string) {
    super(`lease_lost:${runId}`);
    this.name = "LeaseLostError";
  }
}

export class ResumeDigestMismatchError extends Error {
  readonly code = "RESUME_DIGEST_MISMATCH";
  readonly continuity = "GAP" as const;
  constructor(readonly mismatches: readonly ("task" | "skill" | "mcp")[]) {
    super(`resume_digest_mismatch:${mismatches.join(",")}`);
    this.name = "ResumeDigestMismatchError";
  }
}

