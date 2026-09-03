import { describe, expect, it } from "vitest";
import { RouterModelManager } from "../src/models/router-adapter.js";
import type { FetchLike } from "../src/models/http.js";

describe("router model lifecycle", () => {
  it("unloads the prior model, loads one model, and blocks switches while active", async () => {
    const loaded = new Set(["old"]); const requests: Array<{ path: string; body?: unknown }> = []; const order: string[] = []; let releaseChecks = 0;
    const fetcher: FetchLike = async (input, init) => {
      const path = new URL(String(input)).pathname; const body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ path, body });
      if (path === "/models/unload") { order.push("unload"); loaded.delete(body.model); }
      if (path === "/models/load") { order.push("load"); loaded.add(body.model); }
      return new Response(JSON.stringify(path === "/models" ? { data: ["old", "new"].map((id) => ({ id, status: { value: loaded.has(id) ? "loaded" : "unloaded" } })) } : { success: true }), { status: 200 });
    };
    const manager = new RouterModelManager({ baseUrl: "http://127.0.0.1:8080", fetcher, startupTimeoutMs: 100, shutdownTimeoutMs: 500, async releaseProbe() { releaseChecks++; order.push(`release-${releaseChecks}`); return releaseChecks >= 2; } });
    expect(await manager.ensureModel("new")).toMatchObject({ alias: "new", state: "healthy" });
    expect(requests.map((request) => request.path)).toEqual(expect.arrayContaining(["/models/unload", "/models/load"]));
    expect(order.slice(0, 4)).toEqual(["unload", "release-1", "release-2", "load"]);
    manager.beginRequest("new"); await expect(manager.ensureModel("old")).rejects.toThrow(/active/); manager.endRequest("new");
    expect((await manager.stop()).state).toBe("stopped");
  });

  it("fails closed without loading the next model when resources are not released", async () => {
    const loaded = new Set(["old"]); let loadRequests = 0;
    const fetcher: FetchLike = async (input, init) => { const route = new URL(String(input)).pathname; const body = init?.body ? JSON.parse(String(init.body)) : undefined; if (route === "/models/unload") loaded.delete(body.model); if (route === "/models/load") loadRequests++; return new Response(JSON.stringify(route === "/models" ? { data: ["old", "new"].map((id) => ({ id, status: { value: loaded.has(id) ? "loaded" : "unloaded" } })) } : { success: true }), { status: 200 }); };
    const manager = new RouterModelManager({ baseUrl: "http://127.0.0.1:8080", fetcher, shutdownTimeoutMs: 20, releaseProbe: async () => false });
    await expect(manager.ensureModel("new")).rejects.toThrow(/condition was not met/);
    expect(loadRequests).toBe(0);
  });

  it("rejects a wrong runtime artifact instead of accepting a silent fallback", async () => {
    const fetcher: FetchLike = async (input) => new Response(JSON.stringify(new URL(String(input)).pathname === "/models" ? { data: [{ id: "wanted", path: "/models/wrong.gguf", status: { value: "loaded" } }] } : { success: true }), { status: 200 });
    const manager = new RouterModelManager({ baseUrl: "http://127.0.0.1:8080", fetcher, expectedPaths: { wanted: ["/models/right.gguf"] }, startupTimeoutMs: 20 });
    await expect(manager.ensureModel("wanted")).rejects.toThrow(/identity mismatch/);
  });
});
