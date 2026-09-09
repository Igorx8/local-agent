import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

export const projectProfiles = ["auto", "none", "node", "python", "rust", "go"] as const;
export type ProjectProfile = (typeof projectProfiles)[number];
type Command = { command: string; args: string[]; required: boolean; timeoutMs: number };
export interface DetectedProjectProfile { profile: Exclude<ProjectProfile, "auto">; evidence: string[]; quality: Record<string, Command | null>; regression?: Command; }

const command = (executable: string, args: string[]): Command => ({ command: executable, args, required: true, timeoutMs: 600_000 });
async function exists(file: string): Promise<boolean> { try { await access(file); return true; } catch { return false; } }

async function nodeProfile(root: string): Promise<DetectedProjectProfile> {
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  const scripts = manifest.scripts ?? {};
  const manager = await exists(path.join(root, "pnpm-lock.yaml")) ? "pnpm" : await exists(path.join(root, "yarn.lock")) ? "yarn" : await exists(path.join(root, "bun.lock")) || await exists(path.join(root, "bun.lockb")) ? "bun" : "npm";
  const run = (script: string) => command(manager, ["run", script]);
  const test = scripts.test ? (manager === "npm" ? command("npm", ["test"]) : run("test")) : null;
  const typeScript = scripts.typecheck ? "typecheck" : scripts.check ? "check" : undefined;
  return { profile: "node", evidence: ["package.json", `${manager} package manager`], quality: { install: null, test, lint: scripts.lint ? run("lint") : null, typecheck: typeScript ? run(typeScript) : null, coverage: scripts["test:coverage"] ? run("test:coverage") : null, build: scripts.build ? run("build") : null }, regression: test ? command("harness", ["regression-proof", test.command, ...test.args]) : undefined };
}

async function profileFor(root: string, profile: Exclude<ProjectProfile, "auto">): Promise<DetectedProjectProfile> {
  if (profile === "node") return nodeProfile(root);
  if (profile === "python") { const metadata = await readFile(path.join(root, "pyproject.toml"), "utf8"); const test = /\bpytest\b/i.test(metadata) ? command("python3", ["-m", "pytest"]) : null; return { profile, evidence: ["pyproject.toml"], quality: { install: null, test, lint: /\bruff\b/i.test(metadata) ? command("python3", ["-m", "ruff", "check", "."]) : null, typecheck: /\bmypy\b/i.test(metadata) ? command("python3", ["-m", "mypy", "."]) : null, coverage: null, build: null }, regression: test ? command("harness", ["regression-proof", test.command, ...test.args]) : undefined }; }
  if (profile === "rust") { const test = command("cargo", ["test"]); return { profile, evidence: ["Cargo.toml"], quality: { install: null, test, lint: command("cargo", ["clippy", "--all-targets", "--all-features"]), typecheck: command("cargo", ["check"]), coverage: null, build: null }, regression: command("harness", ["regression-proof", test.command, ...test.args]) }; }
  if (profile === "go") { const test = command("go", ["test", "./..."]); return { profile, evidence: ["go.mod"], quality: { install: null, test, lint: command("go", ["vet", "./..."]), typecheck: null, coverage: null, build: null }, regression: command("harness", ["regression-proof", test.command, ...test.args]) }; }
  return { profile: "none", evidence: ["no supported project marker; quality gates require explicit configuration"], quality: { install: null, test: null, lint: null, typecheck: null, coverage: null, build: null } };
}

export async function detectProjectProfile(root: string, requested: ProjectProfile = "auto"): Promise<DetectedProjectProfile> {
  if (requested !== "auto") return profileFor(root, requested);
  const markers = [
    ["node", "package.json"], ["python", "pyproject.toml"], ["rust", "Cargo.toml"], ["go", "go.mod"]
  ] as const;
  const detected: Array<{ profile: Exclude<ProjectProfile, "auto" | "none">; marker: string }> = [];
  for (const [profile, marker] of markers) if (await exists(path.join(root, marker))) detected.push({ profile, marker });
  if (detected.length > 1) throw new Error(`ambiguous project profile (${detected.map((item) => item.marker).join(", ")}); rerun with --profile ${detected.map((item) => item.profile).join("|")} or --profile none and configure gates explicitly`);
  return profileFor(root, detected[0]?.profile ?? "none");
}

export async function initializeProjectConfig(root: string, source: string, requested: ProjectProfile = "auto"): Promise<{ destination: string; detected: DetectedProjectProfile }> {
  const detected = await detectProjectProfile(root, requested);
  const raw = YAML.parse(await readFile(source, "utf8"));
  raw.modelRegistry = path.resolve(path.dirname(source), "models.local.yaml");
  raw.routerPreset = path.resolve(path.dirname(source), "models.local.ini");
  raw.quality = detected.quality;
  raw.verification ??= {};
  raw.verification.commands ??= {};
  if (detected.regression) raw.verification.commands.regression = detected.regression;
  else delete raw.verification.commands.regression;
  const destination = path.join(root, "config", "harness.yaml");
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, YAML.stringify(raw), { flag: "wx", mode: 0o600 });
  return { destination, detected };
}
