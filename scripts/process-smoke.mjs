import { ProcessModelManager } from "../dist/src/models/process-adapter.js";

const root = process.cwd();
const alias = "smoke-qwen";
const output = [];
const manager = new ProcessModelManager({
  baseUrl: "http://127.0.0.1:8080",
  models: {
    [alias]: {
      command: `${root}/.local-runtime/llama.cpp/build/bin/llama-server`,
      args: ["--model", `${root}/.local-runtime/models/qwen2.5-0.5b-instruct-q4_k_m.gguf`, "--alias", alias, "--host", "127.0.0.1", "--port", "8080", "--ctx-size", "4096", "--n-gpu-layers", "99"]
    }
  },
  startupTimeoutMs: 60_000,
  shutdownTimeoutMs: 15_000,
  onProcessOutput(stream, text) { output.push({ stream, text }); }
});

const loaded = await manager.ensureModel(alias);
manager.beginRequest(alias);
const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: alias, messages: [{ role: "user", content: "Reply exactly PROCESS_OK" }], temperature: 0, max_tokens: 16 }) });
const completion = await response.json();
manager.endRequest(alias);
const stopped = await manager.stop();
process.stdout.write(`${JSON.stringify({ loaded, responseStatus: response.status, response: completion.choices?.[0]?.message?.content, stopped, capturedLogChunks: output.length }, null, 2)}\n`);
