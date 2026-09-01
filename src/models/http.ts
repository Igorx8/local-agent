export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export async function checkedJson<T>(fetcher: FetchLike, url: string, init?: RequestInit): Promise<T> {
  const response = await fetcher(url, init);
  const body = await response.text();
  if (!response.ok) throw new Error(`${init?.method ?? "GET"} ${url} returned ${response.status}: ${body.slice(0, 500)}`);
  return body ? JSON.parse(body) as T : {} as T;
}

export async function pollUntil(check: () => Promise<boolean>, timeoutMs: number, initialDelayMs = 100): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let delay = initialDelayMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 2, 2000);
  }
  throw new Error(`condition was not met within ${timeoutMs}ms`);
}
