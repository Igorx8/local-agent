import { connectOpencode } from "../dist/src/opencode/client.js";
import { OpencodeSessions } from "../dist/src/opencode/sessions.js";

const baseUrl = process.env.HARNESS_SMOKE_OPENCODE_URL ?? "http://127.0.0.1:4096";
const directory = process.cwd();
const client = connectOpencode({ baseUrl, directory });
const sessions = new OpencodeSessions(client, directory);
const seenEvents = [];
const eventAbort = new AbortController();
const events = sessions.events(eventAbort.signal);
const eventTask = (async () => {
  for await (const event of events) {
    seenEvents.push(event.type);
    if (seenEvents.length >= 20 || event.type === "session.idle") break;
  }
})();

const session = await sessions.create("harness milestone 3 smoke");
await sessions.prompt({
  sessionID: session.id,
  text: "Reply with exactly OPENCODE_LOCAL_OK and do not use tools.",
  agent: "planner",
  model: { providerID: "llama.cpp", modelID: "smoke-qwen" },
  tools: {}
});
await Promise.race([eventTask, new Promise((resolve) => setTimeout(resolve, 10_000))]);
eventAbort.abort();
await events.return(undefined);
const messages = await sessions.messages(session.id);
const usage = sessions.latestUsage(messages);
const assistant = [...messages].reverse().find((message) => message.info.role === "assistant");
const text = assistant?.parts.filter((part) => part.type === "text").map((part) => part.text).join("") ?? "";

const abortSession = await sessions.create("harness abort smoke");
await sessions.prompt({
  sessionID: abortSession.id,
  text: "Count upward forever, emitting one number per line.",
  agent: "planner",
  model: { providerID: "llama.cpp", modelID: "smoke-qwen" },
  tools: {},
  asynchronous: true
});
const aborted = await sessions.abort(abortSession.id);

process.stdout.write(`${JSON.stringify({
  server: baseUrl,
  sessionID: session.id,
  responseText: text,
  usage,
  events: seenEvents,
  abortSessionID: abortSession.id,
  aborted
}, null, 2)}\n`);
