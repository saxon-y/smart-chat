import { db } from "../src/lib/db";
import { createArtifactStorage } from "../src/lib/ai/artifact-storage";

const retentionDays = Math.max(1, Number(process.env.ARTIFACT_RETENTION_DAYS ?? 30));
const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

async function main() {
  const storage = createArtifactStorage();
  const artifacts = await db.artifact.findMany({ where: { OR: [{ expiresAt: { lt: new Date() } }, { deletedAt: { not: null, lt: cutoff } }] }, select: { id: true, objectKey: true } });
  for (const artifact of artifacts) await storage.delete(artifact.objectKey);
  if (artifacts.length) await db.artifact.deleteMany({ where: { id: { in: artifacts.map(({ id }) => id) } } });
  process.stdout.write(`Removed ${artifacts.length} artifact(s) older than ${retentionDays} day(s).\n`);
}

void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : error}\n`); process.exitCode = 1; }).finally(() => db.$disconnect());
