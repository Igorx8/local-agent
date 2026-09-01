import { RouterModelManager } from "../dist/src/models/router-adapter.js";

const baseUrl = process.env.HARNESS_SMOKE_LLAMA_URL ?? "http://127.0.0.1:8080";
const alias = process.env.HARNESS_SMOKE_MODEL ?? "qwen2.5-0.5b-instruct-q4_k_m";
const manager = new RouterModelManager({ baseUrl, startupTimeoutMs: 60_000 });
const loaded = await manager.ensureModel(alias);
manager.beginRequest(alias);
const response = await fetch(new URL("/v1/chat/completions", baseUrl), {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: alias, messages: [{ role: "user", content: "Reply exactly ROUTER_OK" }], temperature: 0, max_tokens: 16 })
});
const completion = await response.json();
manager.endRequest(alias);
const stopped = await manager.stop();
process.stdout.write(`${JSON.stringify({ loaded, responseStatus: response.status, response: completion.choices?.[0]?.message?.content, usage: completion.usage, stopped }, null, 2)}\n`);
