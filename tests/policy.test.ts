import { describe, expect, it } from "vitest";
import { assertPathWithin, validateCommand } from "../src/tools/policy.js";

describe("command and path policy", () => {
  it("accepts argv without treating metacharacters as shell", () => {
    expect(validateCommand({ command: "node", args: ["-e", "console.log('$HOME; rm -rf /')"], required: true, timeoutMs: 1000 }).args).toHaveLength(2);
  });
  it("denies destructive commands and escaping paths", () => {
    expect(() => validateCommand({ command: "sudo", args: [], required: true, timeoutMs: 1 })).toThrow(/denied/);
    expect(() => validateCommand({ command: "bash", args: ["-c", "echo unsafe"] , required: true, timeoutMs: 1 })).toThrow(/denied/);
    expect(() => validateCommand({ command: "git", args: ["reset", "--hard"], required: true, timeoutMs: 1 })).toThrow(/denied/);
    expect(() => assertPathWithin("/tmp/root", "/tmp/elsewhere")).toThrow(/escapes/);
  });
});
