import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../src/workflow/transitions.js";

describe("workflow transitions", () => {
  it("allows declared flow and terminal failures from active states", () => {
    expect(canTransition("CREATED", "PREFLIGHT")).toBe(true);
    expect(canTransition("GATES_RUNNING", "REPOSITORY_REVIEWING")).toBe(true);
    expect(canTransition("PLANNING", "ESCALATED")).toBe(true);
  });
  it("rejects skipped stages and transitions out of terminal states", () => {
    expect(() => assertTransition("CREATED", "IMPLEMENTING")).toThrow(/invalid/);
    expect(canTransition("SUCCEEDED", "PREFLIGHT")).toBe(false);
  });
});
