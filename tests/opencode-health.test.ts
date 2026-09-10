import { describe, expect, it, vi } from "vitest";
import { assertOpencodeAvailable } from "../src/opencode/health.js";

describe("OpenCode preflight health", () => {
  it("accepts a healthy loopback service", async () => {
    const fetcher = vi.fn(async () => new Response("ok", { status: 200 })); await expect(assertOpencodeAvailable("http://127.0.0.1:4096", fetcher)).resolves.toBeUndefined(); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("fails with an actionable command before model inference", async () => {
    await expect(assertOpencodeAvailable("http://127.0.0.1:4096", async () => { throw new TypeError("fetch failed"); })).rejects.toThrow(/start 'opencode serve.*4096'/);
  });
});
