import { describe, expect, it } from "vitest";
import { RouterModelManager } from "../src/models/router-adapter.js";
import type { FetchLike } from "../src/models/http.js";

describe("router model lifecycle", () => {
  it("unloads the prior model, loads one model, and blocks switches while active", async () => {
    const loaded = new Set(["old"]); const requests: Array<{ path: string; body?: unknown }> = [];
    const fetcher: FetchLike = async (input, init) => {
      const path = new URL(String(input)).pathname; const body = init?.body ? JSON.parse(String(init.body)) : undefined; requests.push({ path, body });
      if (path === "/models/unload") loaded.delete(body.model);
      if (path === "/models/load") loaded.add(body.model);
      return new Response(JSON.stringify(path === "/models" ? { data: ["old", "new"].map((id) => ({ id, status: { value: loaded.has(id) ? "loaded" : "unloaded" } })) } : { success: true }), { status: 200 });
    };
    const manager = new RouterModelManager({ baseUrl: "http://127.0.0.1:8080", fetcher, startupTimeoutMs: 100 });
    expect(await manager.ensureModel("new")).toMatchObject({ alias: "new", state: "healthy" });
    expect(requests.map((request) => request.path)).toEqual(expect.arrayContaining(["/models/unload", "/models/load"]));
    manager.beginRequest("new"); await expect(manager.ensureModel("old")).rejects.toThrow(/active/); manager.endRequest("new");
    expect((await manager.stop()).state).toBe("stopped");
  });
});
