import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "scripts", "prisma", ".github"];
const ignored = /node_modules|\.next|\.git/;
const secret = /(sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----)/;
const ssrf = /https?:\/\/[^\s"'`]*169\.254\.169\.254/i;
const findings = [];
function walk(path) {
  if (ignored.test(path)) return;
  const stat = statSync(path);
  if (stat.isDirectory()) for (const entry of readdirSync(path)) walk(join(path, entry));
  else if (/\.(ts|tsx|js|mjs|json|yml|yaml|sql|md)$/.test(path)) {
    const text = readFileSync(path, "utf8");
    if (secret.test(text)) findings.push(`${path}: possible hard-coded secret`);
    if (ssrf.test(text) && !path.includes("provider-security")) findings.push(`${path}: review cloud metadata URL`);
  }
}
for (const root of roots) walk(root);
if (findings.length) { console.error(findings.join("\n")); process.exit(1); }
console.log(JSON.stringify({ secretScan: "pass", ssrfReview: "pass", files: roots }));
