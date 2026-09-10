import { describe, expect, it, vi } from "vitest";
import { ensureOpencodeService } from "../src/opencode/service.js";

describe("managed OpenCode service", () => {
  it("reuses a healthy service and never claims or closes it", async () => {
    const starter = vi.fn(); const service = await ensureOpencodeService({ baseUrl: "http://127.0.0.1:4096", fetcher: async () => new Response("ok"), starter }); await service.close(); expect(service.owned).toBe(false); expect(starter).not.toHaveBeenCalled();
  });

  it("starts, verifies, and closes exactly one owned service", async () => {
    let probes = 0; const close = vi.fn(); const starter = vi.fn(async () => ({ url: "http://127.0.0.1:4096", close })); const service = await ensureOpencodeService({ baseUrl: "http://127.0.0.1:4096", fetcher: async () => new Response("ok", { status: ++probes === 1 ? 503 : 200 }), starter }); expect(service.owned).toBe(true); expect(starter).toHaveBeenCalledWith(4096); await service.close(); await service.close(); expect(close).toHaveBeenCalledTimes(1);
  });

  it("closes an owned service that fails readiness and rejects non-loopback management", async () => {
    const close = vi.fn(); await expect(ensureOpencodeService({ baseUrl: "http://127.0.0.1:4096", fetcher: async () => new Response("down", { status: 503 }), starter: async () => ({ url: "http://127.0.0.1:4096", close }) })).rejects.toThrow(/did not become ready/); expect(close).toHaveBeenCalledOnce();
    await expect(ensureOpencodeService({ baseUrl: "https://example.com", fetcher: async () => { throw new Error("down"); } })).rejects.toThrow(/loopback/);
  });
});
