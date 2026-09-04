import { assertColdStart, assertEndurance, assertMultiTurn, assertPausedRun, assertRunCounter } from "../dist/src/operational/assertions.js";

const [kind, target, extra] = process.argv.slice(2); let assertion;
if (kind === "multi_turn") assertion = await assertMultiTurn(target, extra);
else if (kind === "repair") assertion = await assertRunCounter(target, "repairIterations", 1);
else if (kind === "handoff") assertion = await assertRunCounter(target, "contextHandoffs", 2);
else if (kind === "pause_resume" || kind === "forced_interrupt") assertion = await assertPausedRun(target);
else if (kind === "endurance") assertion = await assertEndurance(target, extra);
else if (kind === "cold_start") assertion = await assertColdStart(target);
else throw new Error("kind must be multi_turn, repair, handoff, pause_resume, forced_interrupt, endurance, or cold_start");
process.stdout.write(`${JSON.stringify(assertion, null, 2)}\n`);
process.exitCode = assertion.blocked ? 77 : assertion.passed ? 0 : 1;
