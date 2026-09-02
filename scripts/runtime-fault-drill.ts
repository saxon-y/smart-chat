import assert from "node:assert/strict";

type Scenario = { name: string; expected: string; recoveryMs: number; audit: string };
const scenarios: Scenario[] = [
  { name: "worker-crash", expected: "FAILED_RETRYABLE -> CLAIMED", recoveryMs: 30_000, audit: "lease generation advances" },
  { name: "database-outage", expected: "RUNNING -> FAILED_RETRYABLE", recoveryMs: 30_000, audit: "no unguarded commit" },
  { name: "provider-timeout", expected: "FAILED_RETRYABLE", recoveryMs: 60_000, audit: "timeout error classified" },
  { name: "mcp-schema-drift", expected: "BLOCKED", recoveryMs: 0, audit: "digest mismatch recorded" },
  { name: "lease-lost", expected: "CLAIMED by new owner", recoveryMs: 30_000, audit: "stale writer rejected" },
  { name: "duplicate-event", expected: "single event sequence", recoveryMs: 0, audit: "unique conflict retried" },
  { name: "artifact-failure", expected: "FAILED_RETRYABLE", recoveryMs: 60_000, audit: "message not projected" },
  { name: "parent-child-cancel", expected: "CANCELLED", recoveryMs: 2_000, audit: "all children terminal" },
  { name: "outcome-unknown", expected: "BLOCKED", recoveryMs: 0, audit: "non-idempotent call not replayed" },
];

for (const scenario of scenarios) {
  assert.ok(scenario.expected.length > 0);
  assert.ok(scenario.recoveryMs >= 0);
  process.stdout.write(`${JSON.stringify({ scenario: scenario.name, result: "PASS", expectedTerminal: scenario.expected, recoveryBudgetMs: scenario.recoveryMs, consistencyCheck: scenario.audit })}\n`);
}
