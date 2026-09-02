export const TERMINAL_RUN_STATUSES = ["SUCCEEDED", "CANCELLED", "FAILED_FINAL", "BLOCKED"] as const;

export interface RetentionTarget { id: string; runId: string; createdAt: Date }
export interface RetentionPlan { cutoff: Date; deltaEvents: RetentionTarget[]; turns: RetentionTarget[] }
export interface RetentionSummary {
  auditVersion: 1;
  auditId: string;
  generatedAt: string;
  cutoff: string;
  retentionDays: number;
  dryRun: boolean;
  candidates: { deltaEvents: number; turns: number };
  deleted: { deltaEvents: number; turns: number };
  targetIds: { deltaEvents: string[]; turns: string[] };
}

export interface RetentionStore {
  plan(cutoff: Date): Promise<RetentionPlan>;
  remove(plan: RetentionPlan): Promise<{ deltaEvents: number; turns: number }>;
}
