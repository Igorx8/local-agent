import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { executeConfigured } from "../src/tools/executor.js";

describe("configured executor", () => {
  it("captures separate bounded streams and stores the complete log", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "executor-"));
    const logPath = path.join(directory, "gate.json");
    const result = await executeConfigured({ command: "printf", args: ["abcdefgh"], required: true, timeoutMs: 2000 }, { cwd: directory, outputLimitBytes: 4, logPath });
    expect(result.stdout).toBe("abcd"); expect(result.stdoutTruncated).toBe(true); expect(result.stderr).toBe("");
    expect(JSON.parse(await readFile(logPath, "utf8")).stdout).toBe("abcdefgh");
  });
  it("does not invoke a shell", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "executor-shell-"));
    const result = await executeConfigured({ command: "printf", args: ["; touch owned"], required: true, timeoutMs: 2000 }, { cwd: directory });
    expect(result.stdout).toBe("; touch owned");
  });
  it("terminates a timed-out process group", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "executor-timeout-"));
    const result = await executeConfigured({ command: "sleep", args: ["2"], required: true, timeoutMs: 20 }, { cwd: directory });
    expect(result.timedOut).toBe(true); expect(result.signal).toBe("SIGTERM");
  });
});
