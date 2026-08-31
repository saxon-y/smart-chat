const endpoint = process.env.AGENT_WORKER_URL ?? "http://localhost:3000/api/internal/agent-worker";
const secret = process.env.AGENT_WORKER_SECRET;
const intervalMs = Math.max(500, Number(process.env.AGENT_WORKER_INTERVAL_MS ?? 2000));

async function tick() {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
  if (!response.ok) throw new Error(`worker_http_${response.status}`);
}

async function main() {
  process.stdout.write(`Agent worker polling ${endpoint}\n`);
  for (;;) {
    await tick().catch((error) => process.stderr.write(`${error instanceof Error ? error.message : error}\n`));
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

void main();
