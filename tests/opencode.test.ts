import { describe, expect, it } from "vitest";
import type { AssistantMessage, OpencodeClient } from "@opencode-ai/sdk";
import { connectOpencode, responseData } from "../src/opencode/client.js";
import { OpencodeSessions, parseModelAlias } from "../src/opencode/sessions.js";

describe("OpenCode adapter", () => {
  it("only connects to loopback and parses provider/model without losing slashes", () => {
    expect(() => connectOpencode({ baseUrl: "http://192.168.1.2:4096", directory: "/tmp" })).toThrow(/loopback/);
    expect(parseModelAlias("llama.cpp/org/model")).toEqual({ providerID: "llama.cpp", modelID: "org/model" });
    expect(() => responseData({ error: { message: "bad" } })).toThrow(/failed/);
  });
  it("uses SDK message metadata as exact token provenance", () => {
    const sessions = new OpencodeSessions({} as OpencodeClient, "/tmp");
    const info = { role: "assistant", tokens: { input: 120, output: 30, reasoning: 5, cache: { read: 10, write: 2 } } } as AssistantMessage;
    expect(sessions.latestUsage([{ info }])).toEqual({ input: 120, output: 30, reasoning: 5, cacheRead: 10, cacheWrite: 2, provenance: "opencode_message_metadata" });
  });
  it("submits agent and model through the typed SDK shape", async () => {
    let received: unknown;
    const client = { session: { prompt: async (value: unknown) => { received = value; return { data: { ok: true } }; } } } as unknown as OpencodeClient;
    const sessions = new OpencodeSessions(client, "/repo");
    await sessions.prompt({ sessionID: "ses-1", text: "plan", agent: "planner", model: { providerID: "llama.cpp", modelID: "qwen" } });
    expect(received).toMatchObject({ path: { id: "ses-1" }, query: { directory: "/repo" }, body: { agent: "planner", model: { providerID: "llama.cpp", modelID: "qwen" }, parts: [{ type: "text", text: "plan" }] } });
  });
});
