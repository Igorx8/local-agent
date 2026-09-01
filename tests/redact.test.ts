import { describe, expect, it } from "vitest";
import { redact } from "../src/telemetry/redact.js";

describe("redact", () => {
  it("redacts secret fields recursively and bearer values", () => {
    expect(redact({ apiKey: "abc", nested: { password: "xyz", message: "Bearer secret.token" } })).toEqual({ apiKey: "[REDACTED]", nested: { password: "[REDACTED]", message: "Bearer [REDACTED]" } });
  });
});
