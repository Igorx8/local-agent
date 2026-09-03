import { mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import lockfile from "proper-lockfile";
import { conversationMemorySchema, conversationStateSchema, type ConversationMemory, type ConversationState } from "./types.js";

export class ConversationStore {
  constructor(readonly directory: string) {}
  get statePath(): string { return path.join(this.directory, "conversation.json"); }
  get memoryPath(): string { return path.join(this.directory, "memory.json"); }
  async initialize(state: ConversationState): Promise<void> { await mkdir(this.directory, { recursive: true }); await this.writeState(state); await this.writeMemory({ schemaVersion: 1, conversationId: state.id, compacted: [], recent: [] }); }
  async readState(): Promise<ConversationState> { return conversationStateSchema.parse(JSON.parse(await readFile(this.statePath, "utf8"))); }
  async readMemory(): Promise<ConversationMemory> { return conversationMemorySchema.parse(JSON.parse(await readFile(this.memoryPath, "utf8"))); }
  async writeState(state: ConversationState): Promise<void> { await this.atomic(this.statePath, conversationStateSchema.parse({ ...state, updatedAt: new Date().toISOString() })); }
  async writeMemory(memory: ConversationMemory): Promise<void> { await this.atomic(this.memoryPath, conversationMemorySchema.parse(memory)); }
  async acquireLock(): Promise<() => Promise<void>> { await mkdir(this.directory, { recursive: true }); const target = path.join(this.directory, ".conversation-lock"); const handle = await open(target, "a", 0o600); await handle.close(); return lockfile.lock(target, { realpath: false, retries: 0 }); }
  private async atomic(file: string, value: unknown): Promise<void> { await mkdir(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`; const handle = await open(temporary, "wx", 0o600); try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync(); } finally { await handle.close(); } try { await rename(temporary, file); } catch (error) { await rm(temporary, { force: true }); throw error; } }
}

export const conversationRoot = (workspace: string): string => path.join(workspace, ".agent-harness", "conversations");
export async function latestConversation(workspace: string): Promise<string | undefined> { const root = conversationRoot(workspace); const entries = await readdir(root, { withFileTypes: true }).catch(() => []); const states: ConversationState[] = []; for (const entry of entries.filter((item) => item.isDirectory())) try { states.push(await new ConversationStore(path.join(root, entry.name)).readState()); } catch { /* invalid conversations are not silently selected */ } return states.filter((state) => state.status !== "closed").sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1)?.id; }
