import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { loadConfig } from "../dist/src/config.js";
import { loadModelRegistry } from "../dist/src/models/registry.js";
import { resolveFileReferences } from "../dist/src/input/file-references.js";
import { benchmarkFingerprint } from "../dist/src/evaluation/document-benchmark.js";
import { deriveMarkdownContract, evaluateDocumentQuality, validateMarkdownQuality } from "../dist/src/tools/markdown-quality.js";

const execute = promisify(execFile);
const option = (name) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`missing ${name}`); return process.argv[index + 1]; };
const optionalOption = (name) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const harnessBuild = path.resolve(option("--harness-build"));
const fixture = path.resolve(option("--fixture"));
const output = path.resolve(option("--output"));
const existingRepository = optionalOption("--existing-repository");
const repository = existingRepository ? path.resolve(existingRepository) : await mkdtemp(path.join(tmpdir(), "local-agent-document-benchmark-"));
const prompt = (await readFile(path.join(fixture, "prompt.txt"), "utf8")).trim();
const plan = await readFile(path.join(fixture, "plan.md"), "utf8");

if (!existingRepository) {
  await mkdir(path.join(repository, "tasks"), { recursive: true });
  await writeFile(path.join(repository, "plan.md"), plan);
  await writeFile(path.join(repository, "tasks", "README.md"), plan);
  await writeFile(path.join(repository, ".gitignore"), ".agent-harness/\n");
  await execute("git", ["init", "-b", "main"], { cwd: repository });
  await execute("git", ["add", "."], { cwd: repository });
  await execute("git", ["-c", "user.name=Benchmark", "-c", "user.email=benchmark@localhost", "commit", "-m", "benchmark fixture"], { cwd: repository, env: { ...process.env, GIT_AUTHOR_DATE: "2026-01-01T00:00:00Z", GIT_COMMITTER_DATE: "2026-01-01T00:00:00Z" } });
}
const initialTreeHash = (await execute("git", ["rev-parse", "HEAD^{tree}"], { cwd: repository })).stdout.trim();

const config = await loadConfig(path.resolve("config/harness.example.yaml"));
const resolved = await resolveFileReferences(repository, prompt, config);
const workflow = await import(pathToFileURL(path.join(harnessBuild, "dist/src/workflow/fix.js")).href);
let result; let workflowError;
try {
  if (existingRepository) { const runsRoot = path.join(repository, ".agent-harness", "runs"); const runId = (await readdir(runsRoot)).sort().at(-1); if (!runId) throw new Error("existing benchmark repository has no run"); const artifactPath = path.join(runsRoot, runId); result = JSON.parse(await readFile(path.join(artifactPath, "state.json"), "utf8")); result.artifactPath = artifactPath; workflowError = result.status === "succeeded" ? undefined : "captured existing failed benchmark run"; }
  else result = await workflow.startFocusedFix({ repository, task: resolved.prompt, config, mode: "doc" });
}
catch (error) {
  workflowError = error instanceof Error ? error.message : String(error);
  const runsRoot = path.join(repository, ".agent-harness", "runs"); const runId = (await readdir(runsRoot)).sort().at(-1); if (!runId) throw error;
  const artifactPath = path.join(runsRoot, runId); result = JSON.parse(await readFile(path.join(artifactPath, "state.json"), "utf8")); result.artifactPath = artifactPath;
}

let performance;
try { performance = JSON.parse(await readFile(path.join(result.artifactPath, "performance.json"), "utf8")); }
catch {
  const events = (await readFile(path.join(result.artifactPath, "events.jsonl"), "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const steps = events.filter((event) => event.type === "agent.step"); const starts = events.filter((event) => event.type === "agent.start");
  const first = Date.parse(events[0]?.timestamp); const last = Date.parse(events.at(-1)?.timestamp);
  performance = { totalDurationMs: Math.max(0, last - first), agents: starts.map((event) => ({ role: event.data.role, alias: event.data.alias })), totals: { inputTokens: steps.reduce((sum, event) => sum + (event.data.inputTokens ?? 0), 0), outputTokens: steps.reduce((sum, event) => sum + (event.data.outputTokens ?? 0), 0), toolCalls: events.filter((event) => event.type === "agent.tool" && event.data.status === "pending").length }, counters: result.counters };
}
const finalDocument = await readFile(path.join(repository, "tasks", "README.md"), "utf8");
const contract = deriveMarkdownContract(resolved.prompt);
const quality = evaluateDocumentQuality(validateMarkdownQuality(finalDocument, contract), contract, resolved.prompt);
const preserved = finalDocument.replace(/^([-*+]\s+)TASK-\d+:\s+/gm, "$1") === plan;
const unsupported = quality.find((item) => item.dimension === "unsupported-invention"); if (unsupported) { unsupported.status = preserved ? "pass" : "fail"; unsupported.evidence = [preserved ? "all bytes outside structured identifiers were preserved" : "content outside structured identifiers differs from the fixture"]; }
const registry = await loadModelRegistry(config.modelRegistry);
const modelFingerprint = benchmarkFingerprint(JSON.stringify(Object.fromEntries(Object.entries(registry.artifacts ?? {}).sort(([left], [right]) => left.localeCompare(right)))));
const version = async (command, args) => { try { const result = await execute(command, args); return `${result.stdout}${result.stderr}`.trim(); } catch (error) { return String(error); } };
const opencodeVersion = await version("opencode", ["--version"]); const llamaVersion = await version("llama-server", ["--version"]);
const runtimeFingerprint = benchmarkFingerprint(JSON.stringify({ node: process.version, opencode: opencodeVersion.match(/\d+\.\d+\.\d+(?:[-+][\w.-]+)?/)?.[0] ?? opencodeVersion, llama: llamaVersion.match(/version(?::|\s)\s*([^\n]+)/i)?.[1]?.trim() ?? llamaVersion, nvidia: await version("nvidia-smi", ["--query-gpu=name,driver_version", "--format=csv,noheader"]) }));
const agents = performance.agents ?? [];
const modelSwitches = agents.reduce((count, agent, index) => index > 0 && agents[index - 1]?.alias !== agent.alias ? count + 1 : count, 0);
const snapshot = {
  workflowStatus: result.status === "succeeded" ? "succeeded" : "failed",
  fixtureSha256: benchmarkFingerprint(Buffer.concat([Buffer.from(prompt), Buffer.from([0]), Buffer.from(plan)])),
  promptSha256: benchmarkFingerprint(prompt), initialTreeHash, runtimeFingerprint, modelFingerprint, quality,
  metrics: { totalDurationMs: performance.totalDurationMs, inputTokens: performance.totals.inputTokens, outputTokens: performance.totals.outputTokens, toolCalls: performance.totals.toolCalls, modelSwitches, retries: performance.counters.inferenceRetries, repairs: performance.counters.repairIterations },
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
await cp(path.join(repository, "tasks", "README.md"), `${output}.md`);
process.stdout.write(`${JSON.stringify({ output, document: `${output}.md`, repository, runId: result.runId, workflowStatus: snapshot.workflowStatus, ...(workflowError ? { workflowError } : {}), metrics: snapshot.metrics }, null, 2)}\n`);
