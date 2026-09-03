const secretKey = /^(authorization|api[-_]?key|token|password|secret)$/i;
const bearer = /Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi;

export function redact(value: unknown, secretValues: string[] = [], patterns: string[] = []): unknown {
  if (typeof value === "string") { let result = value.replace(bearer, "Bearer [REDACTED]"); for (const secret of secretValues) if (secret) result = result.split(secret).join("[REDACTED]"); for (const source of patterns) { try { result = result.replace(new RegExp(source, "gi"), "[REDACTED]"); } catch { /* Invalid configured patterns are ignored here and reported by configuration validation. */ } } return result; }
  if (Array.isArray(value)) return value.map((child) => redact(child, secretValues, patterns));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, secretKey.test(key) ? "[REDACTED]" : redact(child, secretValues, patterns)]));
  return value;
}
