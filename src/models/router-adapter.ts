import { ActiveModelRequestError, type ModelLifecycle, type ModelStatus } from "./types.js";
import { checkedJson, pollUntil, type FetchLike } from "./http.js";

interface RouterModel { id: string; path?: string; model?: string; status?: { value?: string; failed?: boolean; args?: string[] }; }
interface ModelsResponse { data: RouterModel[]; }
export interface RouterOptions { baseUrl: string; apiKey?: string; startupTimeoutMs?: number; shutdownTimeoutMs?: number; fetcher?: FetchLike; expectedPaths?: Record<string, string[]>; releaseProbe?: () => Promise<boolean>; admissionProbe?: (alias: string) => Promise<void>; }

export class RouterModelManager implements ModelLifecycle {
  private current: ModelStatus = { state: "stopped" };
  private activeRequests = 0;
  private readonly fetcher: FetchLike;
  constructor(private readonly options: RouterOptions) { this.fetcher = options.fetcher ?? fetch; }
  status(): ModelStatus { return { ...this.current }; }
  beginRequest(alias: string): void { if (this.current.alias !== alias || this.current.state !== "healthy") throw new Error(`model is not healthy: ${alias}`); this.activeRequests += 1; this.current = { ...this.current, state: "generating" }; }
  endRequest(alias: string): void { if (this.current.alias !== alias || this.activeRequests === 0) throw new Error(`no active request for model: ${alias}`); this.activeRequests -= 1; if (!this.activeRequests) this.current = { ...this.current, state: "healthy" }; }
  private headers(): HeadersInit { return { "content-type": "application/json", ...(this.options.apiKey ? { authorization: `Bearer ${this.options.apiKey}` } : {}) }; }
  private url(route: string): string { return new URL(route, this.options.baseUrl).toString(); }
  private async models(): Promise<RouterModel[]> { return (await checkedJson<ModelsResponse>(this.fetcher, this.url("/models"), { headers: this.headers() })).data; }

  async ensureModel(alias: string): Promise<ModelStatus> {
    if (this.activeRequests) throw new ActiveModelRequestError("cannot switch models while a response is active");
    this.current = { alias, state: "loading" };
    try {
      const models = await this.models();
      const loadedBefore = models.filter((item) => item.status?.value === "loaded"); const targetAlreadyExclusive = loadedBefore.length === 1 && loadedBefore[0]?.id === alias && !loadedBefore[0]?.status?.failed;
      if (!targetAlreadyExclusive && loadedBefore.length) {
        for (const model of loadedBefore) await checkedJson(this.fetcher, this.url("/models/unload"), { method: "POST", headers: this.headers(), body: JSON.stringify({ model: model.id }) });
        const timeout = this.options.shutdownTimeoutMs ?? 30_000;
        await pollUntil(async () => (await this.models()).every((model) => model.status?.value !== "loaded"), timeout);
        if (this.options.releaseProbe) await pollUntil(this.options.releaseProbe, timeout);
      }
      if (!targetAlreadyExclusive) { await this.options.admissionProbe?.(alias); await checkedJson(this.fetcher, this.url("/models/load"), { method: "POST", headers: this.headers(), body: JSON.stringify({ model: alias }) }); }
      await pollUntil(async () => (await this.models()).some((model) => model.id === alias && model.status?.value === "loaded" && !model.status.failed), this.options.startupTimeoutMs ?? 120_000);
      const loaded = (await this.models()).filter((model) => model.status?.value === "loaded");
      if (loaded.length !== 1 || loaded[0]?.id !== alias) throw new Error(`router invariant failed: expected only ${alias} loaded`);
      const expected = this.options.expectedPaths?.[alias];
      if (expected) {
        const modelArgs = loaded[0]?.status?.args; const modelIndex = modelArgs?.indexOf("--model") ?? -1;
        const identity = loaded[0]?.path ?? loaded[0]?.model ?? (modelIndex >= 0 ? modelArgs?.[modelIndex + 1] : undefined);
        if (!identity || !expected.includes(identity)) throw new Error(`runtime identity mismatch for ${alias}: ${identity ?? "identity unavailable"}`);
      }
      return this.current = { alias, state: "healthy" };
    } catch (error) { this.current = { alias, state: "error", detail: error instanceof Error ? error.message : String(error) }; throw error; }
  }
  async stop(): Promise<ModelStatus> {
    if (this.activeRequests) throw new ActiveModelRequestError("cannot unload while a response is active");
    const loaded = (await this.models()).filter((model) => model.status?.value === "loaded");
    if (loaded.length) { this.current = { ...this.current, state: "unloading" }; for (const model of loaded) await checkedJson(this.fetcher, this.url("/models/unload"), { method: "POST", headers: this.headers(), body: JSON.stringify({ model: model.id }) }); const timeout = this.options.shutdownTimeoutMs ?? 30_000; await pollUntil(async () => (await this.models()).every((model) => model.status?.value !== "loaded"), timeout); if (this.options.releaseProbe) await pollUntil(this.options.releaseProbe, timeout); }
    return this.current = { state: "stopped" };
  }
}
