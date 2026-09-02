import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { db } from "../src/lib/db.ts";
import { PrismaRetentionStore } from "../src/lib/harness/retention/prisma-store.ts";
import { cleanupRuntimeRecords } from "../src/lib/harness/retention/service.ts";

const execute = process.argv.includes("--execute");
const retentionDays = Number(process.env.RUNTIME_RECORD_RETENTION_DAYS ?? 30);
const auditFile = resolve(process.env.RUNTIME_RETENTION_AUDIT_FILE ?? ".omx/logs/runtime-retention-audit.jsonl");

async function main() {
  const summary = await cleanupRuntimeRecords(new PrismaRetentionStore(db), { retentionDays, dryRun: !execute });
  await mkdir(dirname(auditFile), { recursive: true });
  await appendFile(auditFile, `${JSON.stringify(summary)}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
