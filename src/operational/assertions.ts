import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { conversationStateSchema } from "../conversation/types.js";
import { runStateSchema, type RunState } from "../state/types.js";
import { readEvents } from "../telemetry/events.js";

export interface OperationalAssertion { passed: boolean; blocked?: boolean; evidence: string[]; failures: string[]; }
async function runState(runDirectory: string): Promise<RunState> { return runStateSchema.parse(JSON.parse(await readFile(path.join(runDirectory, "state.json"), "utf8"))); }
function result(evidence: string[], failures: string[], blocked = false): OperationalAssertion { return { passed: !blocked && failures.length === 0, ...(blocked ? { blocked: true } : {}), evidence, failures }; }

export async function assertMultiTurn(workspace: string, conversationId: string, minimumTurns = 3): Promise<OperationalAssertion> {
  const file = path.join(workspace, ".agent-harness", "conversations", conversationId, "conversation.json"); const conversation = conversationStateSchema.parse(JSON.parse(await readFile(file, "utf8"))); const evidence: string[] = []; const failures: string[] = [];
  if (conversation.turns.length < minimumTurns) failures.push(`expected at least ${minimumTurns} turns, found ${conversation.turns.length}`);
  for (const turn of conversation.turns) { if (turn.status !== "succeeded" || !turn.finalCommit) failures.push(`turn ${turn.sequence} is not successful`); else evidence.push(`turn ${turn.sequence}: ${turn.baseCommit} -> ${turn.finalCommit}`); }
  for (let index = 1; index < conversation.turns.length; index++) if (conversation.turns[index]!.baseCommit !== conversation.turns[index - 1]!.finalCommit) failures.push(`turn ${index + 1} does not start from the preceding checkpoint`);
  return result(evidence, failures);
}

export async function assertRunCounter(runDirectory: string, counter: "repairIterations" | "contextHandoffs", minimum: number): Promise<OperationalAssertion> {
  const state = await runState(runDirectory); const value = state.counters[counter]; const evidence = [`status=${state.status}`, `${counter}=${value}`, `model=${state.activeModel?.alias ?? "none"}:${state.activeModel?.lifecycle ?? "none"}`]; const failures: string[] = [];
  if (state.status !== "succeeded") failures.push(`run status is ${state.status}`); if (value < minimum) failures.push(`${counter} must be at least ${minimum}`); if (state.activeModel?.lifecycle !== "stopped") failures.push("final model is not stopped");
  if (counter === "repairIterations") { try { await access(path.join(runDirectory, "repairs", "1-regression-proof.json")); evidence.push("regression proof retained"); } catch { failures.push("repair regression proof is missing"); } }
  return result(evidence, failures);
}

export async function assertHandoff(runDirectory: string, minimum = 2): Promise<OperationalAssertion> {
  const state = await runState(runDirectory); const events = await readEvents(runDirectory, Number.MAX_SAFE_INTEGER); const evidence = [`status=${state.status}`, `contextHandoffs=${state.counters.contextHandoffs}`, `model=${state.activeModel?.alias ?? "none"}:${state.activeModel?.lifecycle ?? "none"}`]; const failures: string[] = [];
  if (state.status !== "succeeded") failures.push(`run status is ${state.status}`); if (state.activeModel?.lifecycle !== "stopped") failures.push("final model is not stopped"); if (state.counters.contextHandoffs < minimum) failures.push(`contextHandoffs must be at least ${minimum}`);
  if (state.handoffs.length !== state.counters.contextHandoffs) failures.push("persisted handoffs do not match the counter");
  const newSessions = new Set<string>();
  for (const [index, handoff] of state.handoffs.entries()) { if (handoff.sequence !== index + 1) failures.push(`handoff sequence ${handoff.sequence} is not contiguous`); if (handoff.previousSessionId === handoff.newSessionId || newSessions.has(handoff.newSessionId)) failures.push(`handoff ${handoff.sequence} did not create a unique fresh session`); newSessions.add(handoff.newSessionId); try { await access(handoff.path); } catch { failures.push(`handoff ${handoff.sequence} artifact is missing`); } }
  const restarts = events.filter((event) => event.type === "session.restart"); if (restarts.length < state.handoffs.length) failures.push("a persisted handoff has no session.restart evidence"); else evidence.push(`sessionRestarts=${restarts.length}`);
  const checkpointKeys = state.checkpoints.map((checkpoint) => `${checkpoint.kind}:${checkpoint.iteration}`); if (new Set(checkpointKeys).size !== checkpointKeys.length) failures.push("duplicate mutation checkpoint detected"); else evidence.push(`uniqueCheckpoints=${checkpointKeys.length}`);
  return result(evidence, failures);
}

export async function assertPausedRun(runDirectory: string): Promise<OperationalAssertion> {
  const state = await runState(runDirectory); const events = await readEvents(runDirectory, Number.MAX_SAFE_INTEGER); const evidence = [`status=${state.status}`, `stage=${state.stage}`, `model=${state.activeModel?.lifecycle ?? "none"}`]; const failures: string[] = [];
  if (state.status !== "paused" || state.stage !== "PAUSED") failures.push("run is not paused"); if (!events.some((event) => event.type === "run.paused")) failures.push("run.paused event is missing"); if (state.activeModel?.lifecycle !== "stopped") failures.push("model was not released after pause");
  return result(evidence, failures);
}

export async function assertPauseResume(runDirectory: string): Promise<OperationalAssertion> {
  const state = await runState(runDirectory); const events = await readEvents(runDirectory, Number.MAX_SAFE_INTEGER); const evidence = [`status=${state.status}`, `stage=${state.stage}`, `model=${state.activeModel?.lifecycle ?? "none"}`]; const failures: string[] = [];
  if (state.status !== "succeeded" || state.stage !== "SUCCEEDED") failures.push("resumed run did not succeed"); if (!events.some((event) => event.type === "run.paused")) failures.push("run.paused event is missing"); if (state.activeModel?.lifecycle !== "stopped") failures.push("model was not released after resumed completion");
  const paused = events.find((event) => event.type === "run.paused"); if (paused) evidence.push(`pause=${paused.timestamp}`);
  return result(evidence, failures);
}

export async function assertEndurance(workspace: string, conversationId: string): Promise<OperationalAssertion> {
  const conversationResult = await assertMultiTurn(workspace, conversationId, 5); const conversation = conversationStateSchema.parse(JSON.parse(await readFile(path.join(workspace, ".agent-harness", "conversations", conversationId, "conversation.json"), "utf8")));
  for (const turn of conversation.turns) if (turn.artifactPath) { const state = await runState(turn.artifactPath); if (state.activeModel?.lifecycle !== "stopped") conversationResult.failures.push(`turn ${turn.sequence} retained an active model`); }
  conversationResult.passed = !conversationResult.blocked && conversationResult.failures.length === 0; return conversationResult;
}

export async function assertColdStart(receiptFile: string): Promise<OperationalAssertion> {
  try { const receipt = JSON.parse(await readFile(receiptFile, "utf8")) as { bootIdBefore?: string; bootIdAfter?: string; fishExitCode?: number; ideExitCode?: number }; const failures: string[] = []; if (!receipt.bootIdBefore || !receipt.bootIdAfter || receipt.bootIdBefore === receipt.bootIdAfter) failures.push("receipt does not prove a real reboot"); if (receipt.fishExitCode !== 0) failures.push("Fish startup failed"); if (receipt.ideExitCode !== 0) failures.push("IDE terminal startup failed"); return result([`boot=${receipt.bootIdBefore}->${receipt.bootIdAfter}`, `fish=${receipt.fishExitCode}`, `ide=${receipt.ideExitCode}`], failures); } catch { return result([], [], true); }
}
