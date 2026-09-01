import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { validateCommand, type CommandSpec } from "./policy.js";

export interface ExecutionResult {
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  logPath?: string;
}

export interface ExecuteOptions { cwd: string; outputLimitBytes?: number; logPath?: string; env?: NodeJS.ProcessEnv; }

function bounded(value: Buffer[], limit: number): { text: string; truncated: boolean } {
  const complete = Buffer.concat(value);
  return { text: complete.subarray(0, limit).toString("utf8"), truncated: complete.length > limit };
}

export async function executeConfigured(specInput: CommandSpec, options: ExecuteOptions): Promise<ExecutionResult> {
  const spec = validateCommand(specInput);
  const started = performance.now();
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  let timedOut = false;
  const child = spawn(spec.command, spec.args, { cwd: options.cwd, env: options.env ?? process.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid && process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill("SIGTERM");
  }, spec.timeoutMs);
  const completion = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  }).finally(() => clearTimeout(timer));
  const completeStdout = Buffer.concat(stdout).toString("utf8");
  const completeStderr = Buffer.concat(stderr).toString("utf8");
  if (options.logPath) {
    await mkdir(path.dirname(options.logPath), { recursive: true });
    await writeFile(options.logPath, JSON.stringify({ command: spec.command, args: spec.args, stdout: completeStdout, stderr: completeStderr }, null, 2), { mode: 0o600 });
  }
  const limit = options.outputLimitBytes ?? 64 * 1024;
  const visibleStdout = bounded(stdout, limit);
  const visibleStderr = bounded(stderr, limit);
  return { command: spec.command, args: [...spec.args], exitCode: completion.exitCode, signal: completion.signal, timedOut, durationMs: Math.round(performance.now() - started), stdout: visibleStdout.text, stderr: visibleStderr.text, stdoutTruncated: visibleStdout.truncated, stderrTruncated: visibleStderr.truncated, logPath: options.logPath };
}
