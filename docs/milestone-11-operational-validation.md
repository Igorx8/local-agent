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
- AC-066 passed after a real reboot. The persisted pre-reboot report records boot ID `ec84f59f-40b4-4d49-bc53-faa8bb23fd92`; the post-reboot host reports `b20cb59d-4cc3-4aa8-9088-25ae9ee6f62d`. Both `fish -lc 'harness --version'` and the current IDE terminal returned zero from the sibling Git workspace. The ignored receipt is `.agent-harness/operational-validation/reboot-receipt.json`.
- AC-064 remains blocked after three live attempts. Each failed closed and released the model. The attempts exposed malformed bootstrap JSON and then a handoff abstraction with `filePurposes` emitted as an array. Bootstrap now has bounded fresh-session retries, aborts rejected sessions, accepts harmless text surrounding an otherwise exact JSON object, disables mutation/bash tools, and supplies an exact contract. The abstraction prompt now also supplies its exact shape and types. Deterministic continuity coverage passes, but no live run has yet retained two validated handoffs and reached success.
- Current deterministic baseline after these fixes: 31 test files, 94 tests, typecheck and build all pass.

Remaining before Milestone 11 completion: repeat AC-064 against the hardened abstraction prompt; complete AC-063 with reviewer-discovered production repair and retained fail-before/pass-after proof; complete AC-065 pause-to-success; and run a fresh five-turn AC-068 endurance conversation. AC-062, AC-066, and AC-067 pass.

## Short closure slices

To keep a Codex usage-limit interruption from hiding the verdict, finish the remaining work as four independent slices. Every slice writes its operational report and runs its evidence assertion before another slice starts.

1. **11A — repair (AC-063):** one seeded production defect; stop after reviewer discovery, validation, repair-model switch, regression proof, repeated gates, audit, and the `repair` assertion.
2. **11B — handoff (AC-064):** one small run using the hardened abstraction/bootstrap contract; stop after at least two persisted handoffs, final success, and the `handoff` assertion. If it fails again, preserve the report as runtime-blocked evidence rather than looping.
3. **11C — pause/resume (AC-065):** start one small run, send one cooperative interrupt, immediately assert paused/stopped state, resume the same run, then execute the `pause_resume` assertion.
4. **11D — endurance (AC-068):** execute five individually monitored prompts. Persist one report after each prompt and run the ancestry/resource assertion incrementally; the fifth prompt only supplies the final endurance verdict.

Completed slices do not rerun after a Codex session ends. The next session reads the reports and begins with the first missing or failed slice.

### Slice 11A attempt — 2026-09-09

Run `20260909140103-da32d99c` exercised reviewer discovery, validation, the switch to `qwen3-coder-impl`, repair checkpoint `bc9cbb80949048fbff304a67ba644cac7834bc13`, fail-before/pass-after regression proof, and repeated passing test/typecheck gates. It then failed closed before final audit because independent reviewers reused `F-001` for different findings and the merge retained both IDs, making exact triage coverage impossible. Resource evidence passed: maximum one model process, approximately 0.004 MiB swap growth, and final `model.stopped`. Report: `/home/igor/personal/local-agent-e2e/.agent-harness/operational-validation/11A-repair.json`.

The merge now deterministically namespaces only colliding non-duplicate IDs while preserving semantic duplicate attribution. This is covered by a regression test. AC-063 remains pending until a fresh 11A rerun reaches final success and its `repair` assertion passes.

Retry run `20260909141449-4b6db66c` succeeded functionally in 417,571 ms with maximum one model process and zero swap growth, proving that the ID-collision fix permits final completion. Its independent `repair` assertion failed as designed because the implementation was correct on its first checkpoint (`repairIterations=0`) and therefore produced no regression proof. Report: `/home/igor/personal/local-agent-e2e/.agent-harness/operational-validation/11A-repair-retry-1.json`. AC-063 remains pending; the next attempt uses a deterministic seeded production defect instead of relying on stochastic first-pass model behavior.

Seeded run `20260909142408-98ce1d9c` passes AC-063. It completed in 517,218 ms with implementation checkpoint `2affa7e149bad22f940ef317d41c2ead44ef02fa`, one `qwen3-coder-impl` repair iteration, repair checkpoint `9bd59629d78f62e501b7b4716ead053390466afe`, repeated passing test/typecheck gates, adversarial verification, and final audit. Three retained proofs each report non-zero before with expected reason matched and zero after. The operational driver observed maximum one model process and zero swap growth; final lifecycle is `qwen36-main:stopped`. Both the report `11A-repair-seeded.json` and passing assertion `11A-repair-seeded.assertion.json` are persisted beside earlier attempts. Slice 11A is complete; 11B is next and has not started.

### Slice 11B verdict — 2026-09-09

Run `20260909143944-efa72610` is runtime-blocked for AC-064 after 285,561 ms. Handoff 1 (planner) was persisted, validated, bootstrapped, and resumed successfully. A second validator handoff and semantic abstraction were persisted, but all bounded bootstrap attempts failed the exact pending-acceptance-criteria comparison; mutation was blocked and the run escalated safely. The independent assertion records `status=escalated` and `contextHandoffs=1`, so it correctly fails rather than counting the unverified second handoff. Resource evidence passed with maximum one model process, zero swap growth, and final `qwen36-main:stopped`.

This is the fourth fail-closed live attempt described by the slice history, after prior malformed bootstrap/abstraction responses. Per the one-attempt closure rule, no unbounded retry loop is allowed. The exact prerequisite for changing AC-064 from blocked to passed is either a local-model bootstrap response that reproduces the supplied pending acceptance IDs exactly, or a separately specified implementation that verifies deterministic Git/acceptance identity outside the probabilistic model while retaining independent semantic bootstrap validation. Report `11B-handoff.json` and assertion `11B-handoff.assertion.json` are persisted in the operational-validation directory. Slice 11B has a complete `blocked` verdict; 11C is next and has not started.

The operator chose to resolve the block before 11C. Bootstrap now constructs repository identity, objective, acceptance IDs, allowed files, prohibited actions, and exact next action exclusively from already validated harness state; the model is never asked to reproduce them. The model receives the validated handoff and must return only a strict semantic-continuity confirmation with understood-objective/next-action flags, completed facts, and zero contradictions. Invalid semantics still abort the fresh session and fail closed after bounded retries. Deterministic tests accept reordered sets and reject omitted, invented, or altered state; separate tests reject contradictions and prove deterministic IDs/paths are absent from the semantic-response contract. AC-064 remains blocked until a fresh live 11B report and assertion pass.

Post-fix run `20260909145958-501d7c36` passes AC-064 in 171,206 ms with zero inference retries. Three handoffs (test architect, validator, and adversarial verifier) were persisted, validated, and resumed in three distinct fresh sessions. The workflow succeeded with one unique implementation checkpoint, maximum one model process, approximately 0.297 MiB swap growth, and final `qwen36-main:stopped`. The strengthened handoff assertion additionally verifies contiguous handoff records, one restart per handoff, unique new-session IDs, existing handoff artifacts, and unique kind/iteration checkpoint identities; it passes with `sessionRestarts=3` and `uniqueCheckpoints=1`. Report `11B-handoff-deterministic-bootstrap.json` and its assertion are persisted. Slice 11B is complete; 11C is next and has not started.

### Slice 11C execution adapter

`scripts/validate-pause-resume.mjs` runs the two halves of AC-065 as one monitored scenario without shell interpolation: it snapshots existing run IDs, spawns `harness run` with argv, waits until the new run is actively generating, sends exactly one `SIGINT`, waits for cleanup, persists the immediate `assertPausedRun` result, resumes that exact run ID with argv, and persists `assertPauseResume`. A failed paused-state assertion prevents resume. The outer operational driver remains responsible for process, GPU, RAM, swap, timeout, and final report evidence.

Attempt `20260909173813-aee30f92` proved the first half: one interrupt during acceptance generation persisted `PAUSED`, recorded `run.paused`, and stopped the model; the immediate assertion passed. Resume correctly selected `restart_pre_edit` and re-entered the idempotent prefix, but escalated at oracle validation because a schema-valid response used a criterion description instead of its exact ID. Resource limits passed with one model and zero swap growth. The report and both assertions are retained; AC-065 remains pending.

Oracle and plan reference validation now run inside the bounded inference-retry loop, as triage validation already does, and their prompts explicitly require exact IDs. Challenge-plan and final-audit semantic reference checks receive the same retry treatment on the normal path. A regression test supplies schema-valid but semantically invalid oracle and plan responses, verifies two fresh retries, and reaches success. A fresh 11C attempt is required.

Retry `20260909181224-5d83d6d1` passed both independent assertions: the interrupt persisted `PAUSED` with the model stopped, resume used the same run ID, the workflow reached `SUCCEEDED`, and final cleanup left zero model processes. The outer report nevertheless failed because it treated 1,237.5 MiB of host-wide swap growth as model swap. That attribution is invalid: `/proc/meminfo` includes every process and Linux need not page unrelated memory back in when model RAM is released. The driver now records host swap for diagnosis and separately sums `VmSwap` from live `llama-server` PIDs; only the attributable model delta is compared with `maximumSwapGrowthMiB`. The prior failed report remains retained, and one final 11C rerun is required under the corrected metric.

Final run `20260909182058-c72b24cf` passes AC-065. One `SIGINT` during acceptance generation persisted `PAUSED`, the immediate assertion confirmed the model stopped, and resume continued the same run ID to `SUCCEEDED`. The final assertion confirms cleanup and the pause event. The 171,588 ms outer scenario passed with exit code 0, no timeout, maximum one model process, no inference retries, approximately zero host-swap delta, no attributable model-swap growth, and final lifecycle `qwen36-main:stopped`. Report `11C-pause-resume-retry-2.json` and both canonical assertion files are retained. Slice 11C is complete; 11D/AC-068 is next and was not started.

### Slice 11D resumable adapter

`scripts/validate-endurance-turn.mjs` executes exactly one numbered endurance turn using executable-plus-argv spawning. Turn 1 creates a conversation; turns 2–5 require the preceding persisted progress record and continue its exact conversation ID. After each successful turn it atomically records the conversation/run IDs and writes an incremental ancestry, unique-run, and final-model-cleanup assertion. The outer driver writes a separate resource report for every turn, so interruption never discards earlier verdicts and a failed turn prevents later turns.

Initial turn-1 run `20260909201114-7696126e` failed closed at final audit after all three bounded attempts returned a narrative beginning with `CRITICAL -` rather than the required JSON. No progress record was written and turn 2 was not started. Resource safety passed: maximum one model process, no attributable model-swap growth, and final model cleanup. The auditor contract now explicitly requires every problem, including critical findings, to be encoded in `findings` and `decision` with no narrative outside the JSON object. The failed report is retained before restarting 11D from a new conversation.

The restarted sequence passed turns 1–3 with exact checkpoint ancestry and zero inference retries, then run `20260909202826-6ad616de` failed closed at turn 4. Direct inspection of the local OpenCode session proved that `CRITICAL -` was the platform's `MAXIMUM STEPS REACHED` injection: the auditor spent its bounded steps trying to reconstruct prior Git history with unavailable tools. The final-audit prompt now supplies deterministic changed-file, gate, and independent-review evidence, forbids Git-history discovery, and permits at most two optional tool calls before JSON. This retains bounded independent audit rather than raising the step limit. The three passing reports and failed fourth report remain retained; AC-068 requires a fresh five-success conversation.

After that audit fix, a fresh sequence passed turns 1–2. Run `20260909204159-7f22de6b` then hard-froze the host at the transition from `qwen36-main` planning to `qwen3-coder-impl` implementation, before an implementation response or checkpoint. The previous-boot kernel journal records `list_add corruption` and RCU task-exit warnings at the exact local timestamp, with no OOM-killer or NVIDIA Xid evidence. The reporting process could not flush a turn-3 report; persisted progress remains at two. Because this host previously recorded bad page mappings during in-process GGUF unmapping, router switching is no longer accepted as safe evidence here. Process isolation is now the default, with full process-group exit, endpoint disappearance, VRAM release, and a post-release cooldown required before the next alias starts. AC-068 remains pending until this lifecycle change passes deterministic tests and a fresh endurance sequence.

The first process-isolated attempt failed safely before model residency because OpenCode had not been restarted after the host reboot. A direct one-model process smoke then passed completion and required tool calling, proving the explicit llama.cpp profile itself works; `http://127.0.0.1:4096` was unreachable. New-run preflight now checks OpenCode health before any model action and reports the exact startup command instead of consuming inference retries and surfacing generic `fetch failed`. Report `11D-process-turn-1.json` is retained as prerequisite-failure evidence and is not an AC-068 turn.

After OpenCode startup, process-isolated run `20260910014055-e47036df` succeeded with final cleanup and zero attributable model-swap growth. Its report cannot count toward AC-068 because process telemetry reported zero even while inference ran: explicit `llama serve` uses process name `llama`, while the sampler recognized only `llama-server`. Telemetry now derives both process count and aggregate `VmSwap` from `/proc`, accepting exactly `llama` and `llama-server` while rejecting `llama-cli`. The report is retained, and a fresh sequence is required so every turn proves the single-process invariant with the corrected sampler.
