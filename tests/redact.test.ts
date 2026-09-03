import { describe, expect, it } from "vitest";
import { redact } from "../src/telemetry/redact.js";

describe("redact", () => {
  it("redacts secret fields recursively and bearer values", () => {
    expect(redact({ apiKey: "abc", nested: { password: "xyz", message: "Bearer secret.token" } })).toEqual({ apiKey: "[REDACTED]", nested: { password: "[REDACTED]", message: "Bearer [REDACTED]" } });
  });
  it("redacts raw configured credentials and local secret patterns", () => {
    expect(redact({ output: "key=actual-secret private-123" }, ["actual-secret"], ["private-\\d+"])).toEqual({ output: "key=[REDACTED] [REDACTED]" });
  });
});
