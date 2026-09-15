import { describe, expect, it, vi } from "vitest";
import { invokeFocusedInference } from "../src/workflow/focused-inference.js";

describe("focused inference retries", () => {
  it("retries a transient failure and reports the scheduled attempt", async () => {
    const invoke = vi.fn().mockRejectedValueOnce(new Error("fetch failed")).mockResolvedValue("ok");
    const onRetry = vi.fn().mockResolvedValue(undefined);
    await expect(invokeFocusedInference({ role: "implementer", retries: 2, invoke, onRetry })).resolves.toBe("ok");
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ role: "implementer", attempt: 2, maximum: 3 }));
  });

  it("throws after the configured retry budget is exhausted", async () => {
    const failure = new Error("still unavailable");
    const invoke = vi.fn().mockRejectedValue(failure);
    const onRetry = vi.fn().mockResolvedValue(undefined);
    await expect(invokeFocusedInference({ role: "repair", retries: 1, invoke, onRetry })).rejects.toBe(failure);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("stops immediately when the retry health check rejects", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const healthFailure = new Error("OpenCode unavailable");
    await expect(invokeFocusedInference({ role: "implementer", retries: 2, invoke, onRetry: async () => { throw healthFailure; } })).rejects.toBe(healthFailure);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("does not retry an explicitly non-retryable focused timeout", async () => {
    const invoke = vi.fn().mockRejectedValue(new Error("did not become idle within 180000ms"));
    const onRetry = vi.fn().mockResolvedValue(undefined);
    await expect(invokeFocusedInference({ role: "implementer", retries: 1, invoke, onRetry, shouldRetry: () => false })).rejects.toThrow("180000ms");
    expect(invoke).toHaveBeenCalledTimes(1); expect(onRetry).not.toHaveBeenCalled();
  });
});
