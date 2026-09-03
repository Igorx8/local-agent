import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { runStateSchema, type RunState } from "./types.js";
import { migrateRunState } from "./migrations.js";

export class StateStore {
  constructor(readonly runDirectory: string) {}
  get statePath(): string { return path.join(this.runDirectory, "state.json"); }

  async initialize(state: RunState): Promise<void> {
    await mkdir(this.runDirectory, { recursive: true });
    await this.write(state);
  }

  async read(): Promise<RunState> {
    return migrateRunState(JSON.parse(await readFile(this.statePath, "utf8")));
  }

  async write(input: RunState): Promise<void> {
    const state = runStateSchema.parse({ ...input, updatedAt: new Date().toISOString() });
    await mkdir(this.runDirectory, { recursive: true });
    const temporary = `${this.statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    const handle = await open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, "utf8");
      await handle.sync();
    } finally { await handle.close(); }
    try { await rename(temporary, this.statePath); } catch (error) { await rm(temporary, { force: true }); throw error; }
  }

  async acquireLock(): Promise<() => Promise<void>> {
    await mkdir(this.runDirectory, { recursive: true });
    const target = path.join(this.runDirectory, ".run-lock-target");
    const targetHandle = await open(target, "a", 0o600); await targetHandle.close();
    return lockfile.lock(target, { realpath: false, retries: 0 });
  }
}
