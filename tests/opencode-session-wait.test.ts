import { describe, expect, it, vi } from "vitest";
import { OpencodeSessions } from "../src/opencode/sessions.js";

describe("OpenCode asynchronous session completion", () => {
  it("waits through busy status until the session is idle", async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ data: { "ses-1": { type: "busy" } } })
      .mockResolvedValueOnce({ data: { "ses-1": { type: "idle" } } });
    const sessions = new OpencodeSessions({ session: { status } } as never, "/workspace");
    await expect(sessions.waitUntilIdle("ses-1", 2_000)).resolves.toBeUndefined();
    expect(status).toHaveBeenCalledTimes(2);
  });

  it("recognizes a fast completion even when busy status was not observed", async () => {
    const status = vi.fn().mockResolvedValue({ data: {} });
    const messages = vi.fn().mockResolvedValue({ data: [{ info: { role: "assistant" }, parts: [] }] });
    const sessions = new OpencodeSessions({ session: { status, messages } } as never, "/workspace");
    await expect(sessions.waitUntilIdle("ses-1", 2_000)).resolves.toBeUndefined();
  });

  it("accepts a successful 204 asynchronous prompt response", async () => {
    const promptAsync = vi.fn().mockResolvedValue({ data: undefined });
    const sessions = new OpencodeSessions({ session: { promptAsync } } as never, "/workspace");
    await expect(sessions.prompt({ sessionID: "ses-1", text: "work", agent: "implementer", model: { providerID: "llama.cpp", modelID: "qwen" }, asynchronous: true })).resolves.toBeUndefined();
  });

  it("streams bounded tool, file and token activity while polling", async () => {
    const status = vi.fn().mockResolvedValueOnce({ data: { "ses-1": { type: "busy" } } }).mockResolvedValueOnce({ data: { "ses-1": { type: "idle" } } });
    const parts = [
      { id: "tool-1", sessionID: "ses-1", messageID: "msg-1", type: "tool", tool: "write", state: { status: "running", input: {}, time: { start: 1 } } },
      { id: "patch-1", sessionID: "ses-1", messageID: "msg-1", type: "patch", hash: "abc", files: ["tasks/README.md"] },
      { id: "step-1", sessionID: "ses-1", messageID: "msg-1", type: "step-finish", reason: "tool-calls", cost: 0, tokens: { input: 100, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } }
    ];
    const messages = vi.fn().mockResolvedValue({ data: [{ info: { role: "assistant" }, parts }] }); const activity: unknown[] = [];
    const sessions = new OpencodeSessions({ session: { status, messages } } as never, "/workspace");
    await sessions.waitUntilIdle("ses-1", 2_000, undefined, (item) => { activity.push(item); });
    expect(activity).toEqual([{ type: "tool", tool: "write", status: "running" }, { type: "files", files: ["tasks/README.md"] }, { type: "step", inputTokens: 100, outputTokens: 20, reasoningTokens: 0 }]);
  });

  it("accepts disappearance from the active status map after observing activity", async () => {
    const status = vi.fn()
      .mockResolvedValueOnce({ data: { "ses-1": { type: "busy" } } })
      .mockResolvedValueOnce({ data: {} });
    const sessions = new OpencodeSessions({ session: { status } } as never, "/workspace");
    await expect(sessions.waitUntilIdle("ses-1", 2_000)).resolves.toBeUndefined();
  });

  it("fails with a bounded diagnostic when the session never completes", async () => {
    const status = vi.fn().mockResolvedValue({ data: { "ses-1": { type: "busy" } } });
    const sessions = new OpencodeSessions({ session: { status } } as never, "/workspace");
    await expect(sessions.waitUntilIdle("ses-1", 20)).rejects.toThrow("did not become idle within 20ms");
  });
});
