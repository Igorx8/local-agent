import { assertOpencodeAvailable, type HealthFetch } from "./health.js";
import { startLocalOpencode } from "./client.js";

export interface LocalOpencodeServer { url: string; close(): void; }
export interface ManagedOpencodeService { url: string; owned: boolean; close(): Promise<void>; }
export interface EnsureOpencodeOptions {
  baseUrl: string;
  fetcher?: HealthFetch;
  starter?: (port: number) => Promise<LocalOpencodeServer>;
}

export async function ensureOpencodeService(options: EnsureOpencodeOptions): Promise<ManagedOpencodeService> {
  const fetcher = options.fetcher ?? fetch;
  try { await assertOpencodeAvailable(options.baseUrl, fetcher); return { url: options.baseUrl, owned: false, async close() {} }; } catch { /* start an owned local service */ }
  const target = new URL(options.baseUrl); if (target.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error(`managed OpenCode requires a loopback HTTP URL: ${options.baseUrl}`);
  const port = Number(target.port || 80); const server = await (options.starter ?? (async (value) => startLocalOpencode(value)))(port);
  try { await assertOpencodeAvailable(options.baseUrl, fetcher); }
  catch (error) { server.close(); throw new Error(`owned OpenCode service did not become ready: ${error instanceof Error ? error.message : String(error)}`); }
  let closed = false; return { url: options.baseUrl, owned: true, async close() { if (closed) return; closed = true; server.close(); } };
}
