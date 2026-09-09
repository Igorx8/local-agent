import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertEndurance } from "../dist/src/operational/assertions.js";

const [workspaceArg, configArg, progressArg, assertionArg, turnArg, prompt] = process.argv.slice(2);
if (!workspaceArg || !configArg || !progressArg || !assertionArg || !turnArg || !prompt) throw new Error("usage: validate-endurance-turn <workspace> <config> <progress> <assertion> <turn> <prompt>");
const workspace = path.resolve(workspaceArg); const config = path.resolve(configArg); const progressFile = path.resolve(progressArg); const assertionFile = path.resolve(assertionArg); const expectedTurn = Number(turnArg);
if (!Number.isInteger(expectedTurn) || expectedTurn < 1 || expectedTurn > 5) throw new Error("turn must be an integer from 1 to 5");

let progress;
try { progress = JSON.parse(await readFile(progressFile, "utf8")); } catch (error) { if (error?.code !== "ENOENT") throw error; }
if (expectedTurn === 1 && progress) throw new Error(`endurance progress already exists at turn ${progress.completedTurns}`);
if (expectedTurn > 1 && (!progress || progress.completedTurns !== expectedTurn - 1 || !progress.conversationId)) throw new Error(`turn ${expectedTurn} requires persisted completion of turn ${expectedTurn - 1}`);

const args = expectedTurn === 1
  ? ["run", "--new", "--repo", workspace, "-c", config, prompt]
  : ["continue", "--conversation", progress.conversationId, "--repo", workspace, "-c", config, prompt];
const child = spawn("harness", args, { cwd: workspace, env: process.env, shell: false, stdio: ["ignore", "pipe", "pipe"] }); const stdout = []; const stderr = [];
child.stdout.on("data", (chunk) => { stdout.push(chunk); process.stdout.write(chunk); }); child.stderr.on("data", (chunk) => { stderr.push(chunk); process.stderr.write(chunk); });
const completion = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
if (completion.code !== 0) throw new Error(`harness turn ${expectedTurn} failed with ${completion.code ?? completion.signal}: ${Buffer.concat(stderr).toString("utf8").slice(-2000)}`);
const response = JSON.parse(Buffer.concat(stdout).toString("utf8")); const conversationId = response.conversationId;
if (!conversationId || response.turn !== expectedTurn || response.run?.status !== "succeeded") throw new Error(`turn ${expectedTurn} returned an invalid successful result`);
await mkdir(path.dirname(progressFile), { recursive: true }); const progressTemp = `${progressFile}.${process.pid}.tmp`; await writeFile(progressTemp, `${JSON.stringify({ schemaVersion: 1, conversationId, completedTurns: expectedTurn, runIds: [...(progress?.runIds ?? []), response.run.runId] }, null, 2)}\n`, { mode: 0o600 }); await rename(progressTemp, progressFile);
const assertion = await assertEndurance(workspace, conversationId, expectedTurn); const assertionTemp = `${assertionFile}.${process.pid}.tmp`; await mkdir(path.dirname(assertionFile), { recursive: true }); await writeFile(assertionTemp, `${JSON.stringify(assertion, null, 2)}\n`, { mode: 0o600 }); await rename(assertionTemp, assertionFile);
process.stdout.write(`${JSON.stringify({ endurance: { conversationId, completedTurns: expectedTurn, assertion } }, null, 2)}\n`); if (!assertion.passed) process.exitCode = 1;
