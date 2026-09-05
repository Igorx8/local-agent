# Milestone 10 — live multi-model E2E

Date: 2026-09-03

The production router, OpenCode 1.18.25, all three configured GGUF artifacts, and an isolated sibling TypeScript repository were exercised together. The successful run is `20260903184504-e2873c9f`; its conversation is `conv-20260903184504-4026fd1f` and its immutable implementation checkpoint is `f0173a4477799ac1f4c169b41dea37377355eabe`.

The task added and documented `normalizeSku`, with Node tests for whitespace, case conversion, an already normalized value, and empty input. Baseline gates, implementation gates, repository review, requirements review, finding validation, adversarial verification, and final audit all completed. The run ended `SUCCEEDED` with zero inference retries and zero repair iterations. Its final model lifecycle is `stopped`.

Observed model switching across the then-configured aliases showed one `llama-server` compute process, never two. The controlled standalone switch test likewise kept each alias healthy before the next transition and returned VRAM to the non-model baseline. The current registry has since been reduced to the two Qwen aliases.

## Findings fixed during validation

- Reusing the already healthy sole router alias is now idempotent instead of issuing an invalid duplicate load.
- Every harness role is installed as an explicit OpenCode agent; only implementer and repair receive mutation tools, and nested delegation is disabled.
- Every structured prompt includes the exact generated JSON Schema. Triage rejects a confirmed non-testable finding without a non-empty regression-test exemption while still inside inference retry handling.
- Production profiles use `--load-mode none`. The previous boot journal recorded a kernel `Bad page map in process llama-server` while unmapping the Qwen coder GGUF, followed by an invalid swap entry. Router state at that instant showed only the next model loaded, so the freeze was not simultaneous model residency.
- OpenCode roles have finite step limits, doom-loop denial, and no `todowrite`. An interrupted pre-fix auditor reached more than 280 tool-loop steps; the successful final auditor returned in about 62 seconds under the bounded configuration. The final log audit also found unnecessary `webfetch` and skill-discovery attempts, so both tools are now explicitly disabled for every local role.
- An already accepted OpenCode request must be explicitly aborted when a client is force-stopped; unloading its model alone does not cancel the server-side session. The interrupted validation sessions were explicitly aborted and their models unloaded before subsequent runs.

## Evidence and limits

Artifacts remain under the sibling test repository at `.agent-harness/runs/20260903184504-e2873c9f/`, and the generated report can reconstruct exact model fingerprints, configuration, gates, events, prompts, responses, and checkpoint identity. No result was merged into either repository's default branch.

This validates the installed host and runtime combination, not all possible GPU drivers or kernels. Unexpected power loss can still corrupt Git administrative files; recovery remains fail-closed and never rewrites such metadata automatically.
