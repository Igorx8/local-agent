export type HealthFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export async function assertOpencodeAvailable(baseUrl: string, fetcher: HealthFetch = fetch): Promise<void> {
  try {
    const response = await fetcher(new URL("/", baseUrl), { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenCode is unavailable at ${baseUrl}; start 'opencode serve --hostname 127.0.0.1 --port 4096' before running the harness (${detail})`);
  }
}
