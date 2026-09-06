# Milestone 11 — operational resilience and IDE validation

Milestone 11 separates deterministic implementation coverage from evidence that requires the installed OpenCode, llama.cpp, GPU, Fish, IDE terminal, or a real reboot.

## Cooperative interruption

The active OpenCode session is persisted as soon as it is created, including during recovery. On the first `Ctrl+C`, the CLI writes the pause request, explicitly cancels the accepted server-side session, and aborts the shared signal. The role runner also calls the typed OpenCode session-abort API, the workflow persists `PAUSED`, and final cleanup unloads the model. The same cooperative signal handling applies to `harness resume`. A second interrupt remains an emergency process exit and must not be used as the normal pause path.

`harness resume <run-id> --repo <workspace>` reconciles Git before restarting. A clean pre-edit interruption restarts the idempotent prefix; a clean implementation/repair checkpoint resumes from its gates. Dirty or mismatched Git remains a manual reconciliation.

## Operational driver

Build and execute a JSON manifest:

```fish
npm run validate:operational -- config/operational-validation.local.json
```

Every scenario is an executable plus argv; no shell string is constructed by the driver. Commands run sequentially while the driver samples GPU, model-process count, RAM, and swap. It records bounded stdout/stderr, exit status, timeout state, peak simultaneous model processes, swap growth, and workflow-stage durations when the command emits an `artifactPath`.

Exit code `0` passes. Exit code `77` means a required runtime prerequisite was unavailable and records `blocked`. Any other exit, timeout, more than one model process, or swap growth beyond the manifest limit fails. Reports are written atomically to the configured ignored `.agent-harness` location and never include an injected credential.

Evidence assertions are available through:

```fish
node scripts/assert-operational-evidence.mjs multi_turn /workspace conv-id
node scripts/assert-operational-evidence.mjs repair /workspace/.agent-harness/runs/run-id
node scripts/assert-operational-evidence.mjs handoff /workspace/.agent-harness/runs/run-id
node scripts/assert-operational-evidence.mjs pause_resume /workspace/.agent-harness/runs/run-id
node scripts/assert-operational-evidence.mjs endurance /workspace conv-id
node scripts/assert-operational-evidence.mjs cold_start /path/to/reboot-receipt.json
```

These assertions prove conversation checkpoint ancestry, minimum repair/handoff counters, retained regression proof, paused/stopped lifecycle evidence, and final cleanup across endurance turns. Cold startup deliberately remains blocked until a receipt contains different before/after kernel boot IDs and successful Fish and IDE exit codes.

## Performance evidence

Stage durations are recorded to support a later risk-proportional execution policy. That optimization is deliberately outside this milestone: operational validation must first establish which stages dominate simple, medium, and large tasks without weakening independent review or deterministic gates.

## Validation status

- The deterministic suite covers signal propagation, explicit persisted-session cancellation, recoverable pause classification, pause/resume evidence assertions, resource-limit classification, and stage-duration aggregation.
- The earlier successful production run proves the normal one-model workflow, but does not substitute for the new repair, forced-handoff, pause/resume, multi-turn, and endurance scenarios.
- A live pause test stopped during `testArchitect`, persisted `PAUSED`, performed no abort retry, and released the model. A subsequent resume reached a clean implementation checkpoint and passed both configured gates, but the repository reviewer exhausted repeated tool steps and produced invalid structured output. The run was cooperatively paused again with its checkpoint intact. This is failure evidence, not an AC-065 pass.
- The observed simple two-file task spent most of its wall time in three repository-review attempts. Each attempt was bounded by OpenCode's installed and type-verified `maxSteps`, but the current reviewer limit of 32 permits minutes of low-value file discovery at roughly seven generated tokens/second. A later optimization milestone must calibrate role-specific step budgets and risk-proportional review from operational data; Milestone 11 does not weaken review to mask this result.
- A controlled read-only comparison made `qwen36-main` and `qwen3-coder-impl` read the same three explicit files. Both finished in two agent steps with exactly three reads and no extra discovery; `qwen36-main` produced the stronger repository observation. This prompt was narrower than the full reviewer contract and is only comparative evidence.
- Live run `20260905041020-b5c4a6e5` used `qwen36-main` for repository and requirements reading. The full repository review completed in 50,015 ms with no inference retry and identified that generated tests duplicated production logic. Validation confirmed the finding, the coder created repair checkpoint `db04fa8fbf327beb276f533e32aeb5fc2e529956`, and the run then failed closed because no `verification.commands.regression` adapter was configured. This validates reviewer usefulness and safe evidence enforcement, but does not satisfy AC-063 or prove the revised role mapping end to end.
- The missing regression capability is now supplied by the bundled Git checkpoint adapter configured as `harness regression-proof npm test`. It refuses success unless repaired test files fail against the defective checkpoint and the configured command passes against the repaired checkpoint.
- Clean live run `20260905065408-3aef55bc` passed the complete workflow with the two-Qwen role map, zero inference retries, bounded reviewer exploration, and final `model.stopped` evidence. Its second cumulative turn, `20260905070030-f6c5533f`, also passed and started from the exact first-turn checkpoint `338919a08c2ff69c1033aa7a512d466dc3ae9f47`.
- The third cumulative turn, `20260905070502-4f86e10e`, correctly failed closed. The implementation introduced a TypeScript test incompatible with the fixture's JavaScript test setup, both required gates failed, and the validator returned a schema-valid triage that did not classify every merged finding exactly once. The semantic coverage check escalated the run and cleanup persisted `model.stopped`. Consequently AC-062 and AC-068 remain failed rather than being inferred from the two successful turns; validator semantic-contract retry is a required follow-up before repeating endurance.
- Repository-reviewer, adversarial-verifier, and final-auditor production step limits are now eight. Their live prompts prioritize the supplied changed-file set and bound tool exploration. The clean run completed repository review in 36,709 ms, adversarial verification in 15,544 ms, and final audit in 63,982 ms without an inference retry.
- AC-066 remains runtime-blocked until a real host reboot is performed.

### Incremental rerun — 2026-09-06

- Environment baseline passed with 91 deterministic tests, build, typecheck, Fish CLI/key persistence, two exact Qwen aliases, and no Devstral cache or repository reference.
- AC-062 passed on conversation `conv-20260906164855-02235e24`: turns 1–3 succeeded with exact ancestry `483a8fe9 -> cce67570 -> d0b8e6fe -> ac233dbf`. Each turn was resource-sampled and observed at most one model process with negligible swap growth.
- The same conversation's fourth turn `20260906170405-bab0b94c` failed closed. Review found malformed assertions introduced in the turn, repair fixed only one occurrence, and the regression adapter correctly rejected the still-failing repaired checkpoint. Maximum model processes remained one, swap growth was zero, and cleanup stopped the model. AC-068 remains failed until a fresh five-turn endurance conversation succeeds.
- The regression adapter now distinguishes production repairs from test-only repairs: repaired regression tests are overlaid onto a defective production tree, while a test-only defect is executed verbatim before and after so the overlay cannot erase the defect. Deterministic coverage includes both paths.
