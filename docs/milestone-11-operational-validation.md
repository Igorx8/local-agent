# Milestone 11 — operational resilience and IDE validation

Milestone 11 separates deterministic implementation coverage from evidence that requires the installed OpenCode, llama.cpp, GPU, Fish, IDE terminal, or a real reboot.

## Cooperative interruption

The active OpenCode session is persisted as soon as it is created. On the first `Ctrl+C`, the CLI writes the pause request and aborts the shared signal. The role runner then calls the typed OpenCode session-abort API, the workflow persists `PAUSED`, and final cleanup unloads the model. A second interrupt remains an emergency process exit and must not be used as the normal pause path.

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

- The deterministic suite covers signal propagation, OpenCode session cancellation, recoverable pause classification, evidence assertions, resource-limit classification, and stage-duration aggregation.
- The earlier successful production run proves the normal one-model workflow, but does not substitute for the new repair, forced-handoff, pause/resume, multi-turn, and endurance scenarios.
- AC-066 remains runtime-blocked until a real host reboot is performed.
