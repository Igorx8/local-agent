import { describe, expect, it } from "vitest";
import { ProcessModelManager, type ManagedProcess } from "../src/models/process-adapter.js";
import type { FetchLike } from "../src/models/http.js";

describe("explicit process model lifecycle", () => {
  it("gracefully switches processes and verifies the expected alias", async () => {
    let activeAlias = ""; let pid = 10; const signals: NodeJS.Signals[] = [];
    const processes: ManagedProcess[] = [];
    const launcher = (command: { args: string[] }): ManagedProcess => {
      activeAlias = command.args[0] ?? ""; let resolveExit!: (value: { code: number | null; signal: NodeJS.Signals | null }) => void;
      const process = { pid: pid++, exited: new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => resolveExit = resolve), stop(signal: NodeJS.Signals) { signals.push(signal); activeAlias = ""; resolveExit({ code: null, signal }); } };
      processes.push(process); return process;
    };
    const fetcher: FetchLike = async (input) => new Response(JSON.stringify(new URL(String(input)).pathname === "/health" ? { status: "ok" } : { data: activeAlias ? [{ id: activeAlias }] : [] }), { status: activeAlias ? 200 : 503 });
    const order: string[] = []; const manager = new ProcessModelManager({ baseUrl: "http://127.0.0.1:8080", models: { one: { command: "llama-server", args: ["one"] }, two: { command: "llama-server", args: ["two"] } }, fetcher, launcher(command) { order.push(`load-${command.args[0]}`); return launcher(command); }, async releaseProbe() { order.push("released"); return true; }, async sleeper(milliseconds) { order.push(`cooldown-${milliseconds}`); }, restartCooldownMs: 2000, startupTimeoutMs: 100, shutdownTimeoutMs: 100 });
    expect((await manager.ensureModel("one")).alias).toBe("one");
    expect((await manager.ensureModel("two")).alias).toBe("two");
    expect(signals).toContain("SIGTERM"); expect(processes).toHaveLength(2);
    expect(order).toEqual(["load-one", "released", "cooldown-2000", "load-two"]);
    manager.beginRequest("two"); await expect(manager.stop()).rejects.toThrow(/active/); manager.endRequest("two"); await manager.stop();
  });

  it("recovers an alias whose prior process exited and tolerates ESRCH during cleanup", async () => {
    let launches = 0; let healthy = false;
    const manager = new ProcessModelManager({ baseUrl: "http://127.0.0.1:8080", models: { one: { command: "llama-server", args: ["one"] } }, startupTimeoutMs: 100, shutdownTimeoutMs: 100, async releaseProbe() { return true; }, fetcher: async (input) => new Response(JSON.stringify(new URL(String(input)).pathname === "/health" ? { status: "ok" } : { data: healthy ? [{ id: "one" }] : [] }), { status: healthy ? 200 : 503 }), launcher() { launches++; healthy = true; return { pid: 42 + launches, exited: Promise.resolve({ code: 1, signal: null }), stop() { healthy = false; const error = new Error("gone") as NodeJS.ErrnoException; error.code = "ESRCH"; throw error; } }; } });
    await manager.ensureModel("one"); healthy = false; await manager.ensureModel("one");
    expect(launches).toBe(2); await expect(manager.stop()).resolves.toMatchObject({ state: "stopped" });
  });
});
