import { createOpencodeClient, createOpencodeServer, type OpencodeClient } from "@opencode-ai/sdk";

export interface OpencodeConnection { baseUrl: string; directory: string; }

export function connectOpencode(connection: OpencodeConnection): OpencodeClient {
  const host = new URL(connection.baseUrl).hostname;
  if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) throw new Error(`OpenCode URL must use loopback: ${connection.baseUrl}`);
  return createOpencodeClient({ baseUrl: connection.baseUrl, directory: connection.directory });
}

export async function startLocalOpencode(port = 4096, signal?: AbortSignal): Promise<{ client: OpencodeClient; close(): void; url: string }> {
  const server = await createOpencodeServer({ hostname: "127.0.0.1", port, signal });
  return { url: server.url, client: createOpencodeClient({ baseUrl: server.url }), close: server.close };
}

export function responseData<T>(result: { data?: T; error?: unknown }): T {
  if (result.error !== undefined) throw new Error(`OpenCode request failed: ${JSON.stringify(result.error)}`);
  if (result.data === undefined) throw new Error("OpenCode response did not contain data");
  return result.data;
}
