import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { sha256Digest, skillBundleSchema, type SkillBundle } from "../protocol";

export type SkillSource = "builtin" | "workspace" | "plugin";

export type SkillSelection = Readonly<{
  directory: string;
  source: SkillSource;
}>;

export type LoadSkillBundleOptions = Readonly<{
  root: string;
  skills: readonly SkillSelection[];
  availableTools: ReadonlySet<string>;
  allowedCapabilities: ReadonlySet<string>;
}>;

type SkillManifest = Readonly<{
  id: string;
  name: string;
  version: string;
  files: readonly string[];
  dependencies: readonly string[];
  triggers: readonly string[];
  capabilities: readonly string[];
  requiredTools: readonly string[];
}>;

export class SkillLoadError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "SkillLoadError";
  }
}

function digestBytes(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

function stringArray(value: unknown, field: string, required = false): string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new SkillLoadError("INVALID_MANIFEST", `${field} must be an array of non-empty strings`);
  }
  return [...new Set(value.map((item) => (item as string).trim()))].sort();
}

function parseManifest(content: Buffer, manifestPath: string): SkillManifest {
  let value: unknown;
  try {
    value = JSON.parse(content.toString("utf8"));
  } catch {
    throw new SkillLoadError("INVALID_MANIFEST", `Invalid JSON in ${manifestPath}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SkillLoadError("INVALID_MANIFEST", `Manifest must be an object: ${manifestPath}`);
  }
  const record = value as Record<string, unknown>;
  const requiredString = (field: string) => {
    const item = record[field];
    if (typeof item !== "string" || !item.trim()) throw new SkillLoadError("INVALID_MANIFEST", `${field} must be a non-empty string`);
    return item.trim();
  };
  return {
    id: requiredString("id"),
    name: requiredString("name"),
    version: requiredString("version"),
    files: stringArray(record.files, "files"),
    dependencies: stringArray(record.dependencies, "dependencies"),
    triggers: stringArray(record.triggers, "triggers"),
    capabilities: stringArray(record.capabilities, "capabilities"),
    requiredTools: stringArray(record.requiredTools, "requiredTools"),
  };
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function resolveWithin(root: string, candidate: string, kind: "file" | "directory") {
  const absolute = path.resolve(root, candidate);
  if (!isWithin(root, absolute)) throw new SkillLoadError("PATH_OUTSIDE_ROOT", `Path escapes skill root: ${candidate}`);
  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch {
    throw new SkillLoadError("MISSING_SKILL_FILE", `Missing ${kind}: ${candidate}`);
  }
  if (!isWithin(root, real)) throw new SkillLoadError("PATH_OUTSIDE_ROOT", `Symlink escapes skill root: ${candidate}`);
  const stat = await fs.stat(real);
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
    throw new SkillLoadError("INVALID_SKILL_PATH", `Expected ${kind}: ${candidate}`);
  }
  return real;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export async function loadSkillBundle(options: LoadSkillBundleOptions): Promise<Readonly<SkillBundle>> {
  const root = await fs.realpath(options.root).catch(() => {
    throw new SkillLoadError("MISSING_SKILL_ROOT", `Skill root does not exist: ${options.root}`);
  });
  const requested = new Map(options.skills.map((skill) => [skill.directory, skill.source]));
  const loaded = new Map<string, SkillBundle["skills"][number]>();
  const visiting = new Set<string>();

  const load = async (directory: string, inheritedSource?: SkillSource): Promise<void> => {
    const skillDir = await resolveWithin(root, directory, "directory");
    const manifestPath = await resolveWithin(skillDir, "manifest.json", "file");
    const manifestBytes = await fs.readFile(manifestPath);
    const manifest = parseManifest(manifestBytes, manifestPath);
    if (loaded.has(manifest.id)) return;
    if (visiting.has(manifest.id)) throw new SkillLoadError("SKILL_DEPENDENCY_CYCLE", `Dependency cycle at ${manifest.id}`);
    visiting.add(manifest.id);

    const source = requested.get(directory) ?? inheritedSource;
    if (!source) throw new SkillLoadError("MISSING_SKILL_DEPENDENCY", `Dependency ${directory} is not available`);
    for (const dependency of manifest.dependencies) await load(dependency, source);

    const missingTool = manifest.requiredTools.find((tool) => !options.availableTools.has(tool));
    if (missingTool) throw new SkillLoadError("MISSING_REQUIRED_TOOL", `${manifest.id} requires unavailable tool ${missingTool}`);
    const deniedCapability = manifest.capabilities.find((capability) => !options.allowedCapabilities.has(capability));
    if (deniedCapability) throw new SkillLoadError("CAPABILITY_NOT_ALLOWED", `${manifest.id} requests disallowed capability ${deniedCapability}`);

    const paths = ["SKILL.md", "manifest.json", ...manifest.files];
    const uniquePaths = [...new Set(paths)].sort();
    const snapshots = await Promise.all(uniquePaths.map(async (file) => {
      const real = await resolveWithin(skillDir, file, "file");
      const bytes = await fs.readFile(real);
      return { path: file.split(path.sep).join("/"), sha256: digestBytes(bytes), bytes };
    }));
    const instructionFile = snapshots.find((file) => file.path === "SKILL.md");
    if (!instructionFile) throw new SkillLoadError("MISSING_SKILL_FILE", `${manifest.id} has no SKILL.md`);
    const files = snapshots.map(({ path: file, sha256 }) => ({ path: file, sha256 }));
    const skillWithoutHash = {
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      source,
      instructions: instructionFile.bytes.toString("utf8"),
      files,
      triggers: [...manifest.triggers],
      capabilities: [...manifest.capabilities],
      requiredTools: [...manifest.requiredTools],
    };
    loaded.set(manifest.id, { ...skillWithoutHash, hash: sha256Digest(skillWithoutHash) });
    visiting.delete(manifest.id);
  };

  for (const skill of [...options.skills].sort((a, b) => a.directory.localeCompare(b.directory))) await load(skill.directory);
  const skills = [...loaded.values()].sort((a, b) => a.id.localeCompare(b.id));
  const bundle = skillBundleSchema.parse({ version: 1, skills, bundleHash: sha256Digest({ version: 1, skills }) });
  return deepFreeze(bundle);
}
