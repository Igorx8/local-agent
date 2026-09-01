const secretKey = /^(authorization|api[-_]?key|token|password|secret)$/i;
const bearer = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export function redact(value: unknown): unknown {
  if (typeof value === "string") return value.replace(bearer, "Bearer [REDACTED]");
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(child)]));
  return value;
}
