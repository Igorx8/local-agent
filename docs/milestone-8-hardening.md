# Milestone 8 hardening

Milestone 8 closes the deterministic hardening boundary without adding cloud providers or automatic default-branch merging.

## Recovery and preservation

Every implementation and repair checkpoint is now persisted in `state.json` with commit, tree, changed files, iteration, and timestamp. `harness resume` compares that evidence with the actual isolated worktree and classifies the run as:

- `restart_pre_edit` when the interrupted stage is idempotent and Git is clean;
- `resume_checkpoint` when clean Git identity exactly matches the last checkpoint;
- `manual_reconciliation` when edits are dirty or HEAD differs;
- `terminal` when the run already ended.

Recovery always writes `recovery/plan.json` and `recovery/README.md`. It never resets Git. For `restart_pre_edit`, `resume` clears incomplete derived pointers and restarts the idempotent prefix. For `resume_checkpoint`, it restores the last checkpoint stage and re-enters at gates/review with fresh sessions; it does not rerun the implementer. The configuration and model registry are loaded from immutable run snapshots rather than the caller's current files. `harness abort` creates a cooperative pause request; the active workflow consumes it at the next stage boundary, persists `PAUSED`, blocks mutation, and releases normally. Failed/escalated/paused runs automatically receive recovery material and `report.json`/`report.md`. The report hashes every preserved artifact and points to the configuration, requirements, model manifest, state, worktree, and diagnostic commands.

## Security and reproducibility

- Raw `LLAMA_API_KEY` values, bearer credentials, secret-key fields, and configured regular expressions are redacted recursively before prompt, response, requirement, or handoff-abstraction artifacts are stored.
- Invalid redaction expressions fail configuration validation.
- `storePrompts` and `storeResponses` are enforced; prompt SHA-256 remains available when prompt text storage is disabled.
- Runs fail before worktree creation unless every configured model has an immutable path, byte size, and SHA-256 identity from `model prepare`.
- `model-manifest.json` records alias, Hugging Face reference, quantization, context, roles, artifact identity, Node/OpenCode/llama.cpp version evidence, sampling status, configuration hash, and gate argv.
- Unsupported future state schema versions fail closed; additive version-1 fields receive deterministic defaults.
- Historical metrics now include gate results, diff churn, latest prompt tokens, handoffs, and human interventions in addition to existing verification data.
- OpenCode prompt requests use the installed SDK's verified `RequestInit.signal` support with a configured inference timeout; quality commands retain their process-group timeouts.

The fixed seed remains marked `runtime-dependent-blocked`: the installed API/type surface has not demonstrated an end-to-end seed field, so no field was invented.

## E2E and benchmark evidence

`npm run e2e:projects` creates isolated temporary projects and runs configured commands only as executable plus argv.

Validated on 2026-09-02:

| Project | Gates | Result | Warm duration |
| --- | --- | --- | ---: |
| Python | pytest, Ruff, mypy | 3/3 passed | 409 ms gate time |
| TypeScript | node:test, syntax check, TypeScript check, build | 4/4 passed | 764 ms gate time |
| Combined harness invocation | all above | passed | 1,174 ms |

The first Python run correctly failed on Ruff import spacing while pytest/mypy passed; after correcting only the fixture, the complete rerun passed. This demonstrates required-gate blocking rather than test-count-based success.

The complete live multi-agent E2E is currently **blocked**, not passed: OpenCode 1.18.25 is installed, but `LLAMA_API_KEY` is unset and neither configured local HTTP endpoint responded during this validation. Re-run `harness doctor`, start the local services, and execute a full `harness run` before treating live model orchestration as benchmark evidence.

The deterministic repository suite contains 61 tests across 21 files, including crash/checkpoint re-entry, dirty-worktree preservation, raw credential absence across stored artifacts, migration refusal, and manifest reconstruction.
