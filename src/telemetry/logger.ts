import { mkdirSync } from "node:fs";
import path from "node:path";
import pino, { type Logger } from "pino";

export function createLogger(logFile?: string): Logger {
  if (logFile) mkdirSync(path.dirname(logFile), { recursive: true });
  return pino({ level: process.env.HARNESS_LOG_LEVEL ?? "info", redact: { paths: ["*.authorization", "*.apiKey", "*.api_key", "*.token", "*.password", "*.secret"], censor: "[REDACTED]" } }, logFile ? pino.destination({ dest: logFile, sync: false, mkdir: true }) : undefined);
}
