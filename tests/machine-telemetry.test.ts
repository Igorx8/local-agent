import { describe, expect, it } from "vitest";
import { isLlamaServerProcessName } from "../src/telemetry/machine.js";

describe("machine telemetry process identity", () => {
  it("recognizes router and explicit-process server names", () => {
    expect(isLlamaServerProcessName("llama-server\n")).toBe(true); expect(isLlamaServerProcessName("llama\n")).toBe(true); expect(isLlamaServerProcessName("llama-cli\n")).toBe(false); expect(isLlamaServerProcessName("opencode\n")).toBe(false);
  });
});
