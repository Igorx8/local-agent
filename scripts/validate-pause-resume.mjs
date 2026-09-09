import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPausedRun, assertPauseResume } from "../dist/src/operational/assertions.js";

const [workspaceArg, configArg, taskArg] = process.argv.slice(2);
if (!workspaceArg || !configArg || !taskArg) throw new Error("usage: node scripts/validate-pause-resume.mjs <workspace> <config> <task>");
const workspace = path.resolve(workspaceArg); const config = path.resolve(configArg); const runsDirectory = path.join(workspace, ".agent-harness", "runs"); const assertionDirectory = path.join(workspace, ".agent-harness", "operational-validation");
await mkdir(runsDirectory, { recursive: true }); await mkdir(assertionDirectory, { recursive: true });
const before = new Set(await readdir(runsDirectory));

function execute(command, args) {
  const child = spawn(command, args, { cwd: workspace, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] }); const stdout = []; const stderr = [];
  child.stdout.on("data", (chunk) => { stdout.push(chunk); process.stdout.write(chunk); }); child.stderr.on("data", (chunk) => { stderr.push(chunk); process.stderr.write(chunk); });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") })); });
  return { child, exited };
}
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
async function newRunId(timeoutMs = 60_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const entries = await readdir(runsDirectory); const created = entries.filter((entry) => !before.has(entry)).sort().at(-1); if (created) return created; await delay(250); } throw new Error("pause validation did not observe a new run"); }
async function waitForInference(runDirectory, timeoutMs = 300_000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { try { const state = JSON.parse(await readFile(path.join(runDirectory, "state.json"), "utf8")); if (state.status !== "active") throw new Error(`run became ${state.status} before interrupt`); if (state.activeModel?.lifecycle === "generating") return state.stage; } catch (error) { if (!(error instanceof SyntaxError) && !String(error).includes("ENOENT")) throw error; } await delay(250); } throw new Error("pause validation did not observe active inference"); }

const initial = execute("harness", ["run", "--new", "--repo", workspace, "--config", config, taskArg]); const runId = await newRunId(); const runDirectory = path.join(runsDirectory, runId); const interruptedStage = await waitForInference(runDirectory); initial.child.kill("SIGINT"); const initialExit = await initial.exited;
const paused = await assertPausedRun(runDirectory); await writeFile(path.join(assertionDirectory, "11C-paused.assertion.json"), `${JSON.stringify(paused, null, 2)}\n`);
if (!paused.passed) { process.stdout.write(`${JSON.stringify({ runId, artifactPath: runDirectory, interruptedStage, initialExit, paused }, null, 2)}\n`); process.exit(1); }
const resumed = execute("harness", ["resume", runId, "--repo", workspace]); const resumeExit = await resumed.exited; const final = await assertPauseResume(runDirectory); await writeFile(path.join(assertionDirectory, "11C-pause-resume.assertion.json"), `${JSON.stringify(final, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ runId, artifactPath: runDirectory, interruptedStage, initialExit: { code: initialExit.code, signal: initialExit.signal }, resumeExit: { code: resumeExit.code, signal: resumeExit.signal }, paused, final }, null, 2)}\n`); if (!final.passed || resumeExit.code !== 0) process.exitCode = 1;
