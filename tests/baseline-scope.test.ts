import { describe, expect, it } from "vitest";
import { compareGateResults } from "../src/tools/baseline.js";
import { assertChangedPathsAllowed, evaluateScope } from "../src/tools/scope.js";
import type { GateResult } from "../src/tools/gates.js";

function gate(name: string, status: GateResult["status"]): GateResult { return { name, status, required: true, provenance: "pre_existing", command: "node", args: [], exitCode: status === "passed" ? 0 : 1, signal: null, timedOut: false, durationMs: 1, stdout: "", stderr: "", stdoutTruncated: false, stderrTruncated: false }; }

describe("baseline comparison and scope", () => {
  it("distinguishes pre-existing and introduced failures", () => {
    expect(compareGateResults([gate("test", "failed"), gate("lint", "passed")], [gate("test", "failed"), gate("lint", "failed")])).toEqual({ test: "unchanged_failure", lint: "introduced_failure" });
  });
  it("produces explicit scope evidence", () => {
    const findings = evaluateScope({ files: ["src/a.ts", "secret/key"], addedLines: 900, dependencyFiles: ["package.json"], publicApiChanged: false, migrations: [], productionConfig: [] }, { allowedPaths: ["src"], deniedPaths: ["secret"], maxChangedFilesBeforeReview: 1, maxAddedLinesBeforeReview: 800, requireDependencyChangeJustification: true, requirePublicApiChangeJustification: true, requireMigrationJustification: true });
    expect(findings.map((finding) => finding.code)).toEqual(expect.arrayContaining(["DENIED_PATH", "OUTSIDE_ALLOWED_PATH", "CHANGED_FILE_BUDGET", "ADDED_LINE_BUDGET", "DEPENDENCY_CHANGE"]));
  });
  it("blocks denied secret paths before a checkpoint", () => {
    expect(() => assertChangedPathsAllowed(["src/x.ts"], ["src"], ["**/.env"])).not.toThrow();
    expect(() => assertChangedPathsAllowed(["nested/.env"], [], ["**/.env"])).toThrow(/denied/);
    expect(() => assertChangedPathsAllowed([".env"], [], ["**/.env"])).toThrow(/denied/);
  });
});
