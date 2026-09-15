import { spawn, type ChildProcess } from "node:child_process";
import { ActiveModelRequestError, type ModelLifecycle, type ModelStatus } from "./types.js";
import { checkedJson, pollUntil, type FetchLike } from "./http.js";

export interface ModelProcessCommand { command: string; args: string[]; env?: NodeJS.ProcessEnv; }
export interface ManagedProcess { pid?: number; stop(signal: NodeJS.Signals): void; exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>; }
export type ProcessLauncher = (command: ModelProcessCommand) => ManagedProcess;
export interface ProcessManagerOptions {
  baseUrl: string; models: Record<string, ModelProcessCommand>; apiKey?: string; startupTimeoutMs?: number; shutdownTimeoutMs?: number;
  restartCooldownMs?: number; fetcher?: FetchLike; launcher?: ProcessLauncher; releaseProbe?: (pid?: number) => Promise<boolean>; sleeper?: (milliseconds: number) => Promise<void>; onProcessOutput?: (stream: "stdout" | "stderr", text: string) => void;
  admissionProbe?: (alias: string) => Promise<void>;
}

function launch(command: ModelProcessCommand, onOutput?: ProcessManagerOptions["onProcessOutput"]): ManagedProcess {
  const child: ChildProcess = spawn(command.command, command.args, { env: command.env ?? process.env, shell: false, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.on("data", (chunk: Buffer) => onOutput?.("stdout", chunk.toString("utf8")));
  child.stderr?.on("data", (chunk: Buffer) => onOutput?.("stderr", chunk.toString("utf8")));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve({ code, signal })); });
  return { pid: child.pid, exited, stop(signal) { try { if (child.pid && process.platform !== "win32") process.kill(-child.pid, signal); else child.kill(signal); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; } } };
}

export class ProcessModelManager implements ModelLifecycle {
  private current: ModelStatus = { state: "stopped" };
  private process?: ManagedProcess;
  private activeRequests = 0;
  private readonly fetcher: FetchLike;
  private readonly launcher: ProcessLauncher;
  private readonly sleeper: (milliseconds: number) => Promise<void>;
  constructor(private readonly options: ProcessManagerOptions) { this.fetcher = options.fetcher ?? fetch; this.launcher = options.launcher ?? ((command) => launch(command, options.onProcessOutput)); this.sleeper = options.sleeper ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))); }
  status(): ModelStatus { return { ...this.current }; }
  beginRequest(alias: string): void { if (this.current.alias !== alias || this.current.state !== "healthy") throw new Error(`model is not healthy: ${alias}`); this.activeRequests++; this.current = { ...this.current, state: "generating" }; }
  endRequest(alias: string): void { if (this.current.alias !== alias || !this.activeRequests) throw new Error(`no active request for model: ${alias}`); this.activeRequests--; if (!this.activeRequests) this.current = { ...this.current, state: "healthy" }; }
  private headers(): HeadersInit { return this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}; }
  private url(route: string): string { return new URL(route, this.options.baseUrl).toString(); }
  private async ready(alias: string): Promise<boolean> {
    try {
      await checkedJson(this.fetcher, this.url("/health"), { headers: this.headers() });
      const models = await checkedJson<{ data: Array<{ id: string }> }>(this.fetcher, this.url("/v1/models"), { headers: this.headers() });
      return models.data.some((model) => model.id === alias);
    } catch { return false; }
  }
  private async waitForExit(process: ManagedProcess): Promise<void> {
    const timeout = this.options.shutdownTimeoutMs ?? 15_000;
    const completed = await Promise.race([process.exited.then(() => true), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeout))]);
    if (!completed) { process.stop("SIGKILL"); await process.exited; }
    await pollUntil(async () => {
      try { await checkedJson(this.fetcher, this.url("/health"), { headers: this.headers() }); return false; } catch { return true; }
    }, timeout);
    if (this.options.releaseProbe) await pollUntil(() => this.options.releaseProbe!(process.pid), timeout);
  }
  private async stopProcess(): Promise<boolean> {
    if (!this.process) return false;
    this.current = { ...this.current, state: "unloading" };
    const process = this.process; try { process.stop("SIGTERM"); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; } await this.waitForExit(process); this.process = undefined; return true;
  }
  async ensureModel(alias: string): Promise<ModelStatus> {
    if (this.activeRequests) throw new ActiveModelRequestError("cannot switch models while a response is active");
    const command = this.options.models[alias]; if (!command) throw new Error(`no process command configured for model: ${alias}`);
    if (this.current.alias === alias && this.current.state === "healthy" && await this.ready(alias)) return this.status();
    const stoppedPrevious = await this.stopProcess(); if (stoppedPrevious && (this.options.restartCooldownMs ?? 0) > 0) await this.sleeper(this.options.restartCooldownMs!);
    await this.options.admissionProbe?.(alias);
    for (let attempt = 0; attempt < 2; attempt++) {
      this.current = { alias, state: "loading" }; this.process = this.launcher(command); this.current.pid = this.process.pid;
      let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined; let launchError: unknown;
      void this.process.exited.then((result) => { exited = result; }, (error) => { launchError = error; });
      try {
        await pollUntil(async () => { if (launchError) throw launchError; if (exited) throw new Error(`model process exited before ready: code=${exited.code ?? "none"} signal=${exited.signal ?? "none"}`); return this.ready(alias); }, this.options.startupTimeoutMs ?? 120_000);
        return this.current = { alias, state: "healthy", pid: this.process.pid };
      } catch (error) {
        await this.stopProcess();
        if (attempt === 1) { this.current = { alias, state: "error", detail: error instanceof Error ? error.message : String(error) }; throw error; }
      }
    }
    throw new Error("unreachable model startup state");
  }
  async stop(): Promise<ModelStatus> { if (this.activeRequests) throw new ActiveModelRequestError("cannot stop while a response is active"); await this.stopProcess(); return this.current = { state: "stopped" }; }
}
