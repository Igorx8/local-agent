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
- AC-066 remains runtime-blocked until a real host reboot is performed.
