import { runStateSchema, type RunState } from "./types.js";

export function migrateRunState(value: unknown): RunState {
  if (!value || typeof value !== "object") throw new Error("run state must be an object"); const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version !== 1) throw new Error(`unsupported run state schema version: ${String(version)}`);
  return runStateSchema.parse(value);
}
