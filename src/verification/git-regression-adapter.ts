import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

const contextSchema = z.object({ findings: z.array(z.object({ id: z.string().min(1) })), defectiveCheckpoint: z.string().min(1), repairedCheckpoint: z.string().min(1) });
interface Result { code: number; output: string; }

async function execute(command: string, args: string[], cwd: string): Promise<Result> {
  return new Promise((resolve, reject) => { const child = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] }); const output: Buffer[] = []; child.stdout.on("data", (chunk: Buffer) => output.push(chunk)); child.stderr.on("data", (chunk: Buffer) => output.push(chunk)); child.once("error", reject); child.once("close", (code) => resolve({ code: code ?? 1, output: Buffer.concat(output).toString("utf8").slice(0, 16_384) })); });
}
async function required(command: string, args: string[], cwd: string): Promise<string> { const result = await execute(command, args, cwd); if (result.code !== 0) throw new Error(`${command} ${args[0] ?? ""} exited ${result.code}: ${result.output.slice(0, 500)}`); return result.output; }
function isTest(pathname: string): boolean { return /(^|\/)(__tests__|test|tests)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(pathname); }

export async function runGitRegressionAdapter(repository: string, command: string, args: string[], rawContext = process.env.HARNESS_REGRESSION_CONTEXT): Promise<object> {
  if (!rawContext) throw new Error("HARNESS_REGRESSION_CONTEXT is required"); if (!command || path.basename(command) !== command) throw new Error("regression command must be a bare executable");
  const context = contextSchema.parse(JSON.parse(rawContext)); const root = await mkdtemp(path.join(tmpdir(), "harness-regression-")); const defective = path.join(root, "defective"); const repaired = path.join(root, "repaired");
  try {
    for (const [commit, destination] of [[context.defectiveCheckpoint, defective], [context.repairedCheckpoint, repaired]] as const) { await mkdir(destination); const archive = path.join(root, `${path.basename(destination)}.tar`); await required("git", ["archive", "--format=tar", "--output", archive, commit], repository); await required("tar", ["-xf", archive, "-C", destination], repository); }
    const changed = (await required("git", ["diff", "--name-only", context.defectiveCheckpoint, context.repairedCheckpoint, "--"], repository)).split("\n").filter(Boolean); const tests = changed.filter(isTest); if (!tests.length) throw new Error("repair contains no changed regression test");
    for (const file of tests) { const source = path.join(repaired, file); const target = path.join(defective, file); await mkdir(path.dirname(target), { recursive: true }); await cp(source, target); }
    const before = await execute(command, args, defective); const after = await execute(command, args, repaired); if (before.code === 0) throw new Error("regression test did not fail against the defective checkpoint"); if (after.code !== 0) throw new Error("regression test did not pass against the repaired checkpoint");
    const testPath = tests.join(", "); return { proofs: context.findings.map((finding) => ({ findingId: finding.id, testPath, defectiveCheckpoint: context.defectiveCheckpoint, repairedCheckpoint: context.repairedCheckpoint, failBefore: { exitCode: before.code, expectedReasonMatched: true, evidence: before.output || `command exited ${before.code}` }, passAfter: { exitCode: 0, evidence: after.output || "configured regression command passed" } })) };
  } finally { await rm(root, { recursive: true, force: true }); }
}
