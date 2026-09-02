# Milestone 6 context continuity

The harness treats sessions as disposable and durable state, Git, and artifacts as authoritative. Context pressure uses the latest submitted prompt count, never a sum of historical messages.

## Accounting and thresholds

The fallback order is OpenCode assistant metadata, llama.cpp usage, local tokenizer, then a conservative UTF-8 byte estimate. Every observation records `exact` or `estimated` provenance. The effective handoff threshold is the lower of the configured threshold and the context window minus the reserved-token budget. Projected overflow includes the recent/configured next-turn budget by role.

At handoff or hard-stop pressure, `mutatingActionsBlocked` is persisted before another model action can begin. A handoff failure leaves that guard active and escalates after the single permitted regeneration attempt.

## Handoff lifecycle

Handoffs are Markdown files under the run's `handoffs/` directory. Deterministic identity, Git, gate, finding, model, and acceptance fields come from state and artifacts. A separate LLM pass may only supply semantic summaries, file purposes, and next actions; its schema cannot overwrite deterministic fields.

Validation checks all required headings, size limits, deterministic identities, referenced artifact existence, unresolved findings, required gate failures, runtime identity, Git state, exact next actions, and secret leakage. A child OpenCode session then receives the handoff, verifies the repository read-only, and restates the semantic continuation. Both repository and semantic results must match before execution resumes. Old/new session relationships are persisted in `state.json`.

`harness handoff <run-id> --repo <path>` writes an atomic request file. The active runner consumes it at the next safe model-action boundary, so the command cannot race by rewriting the locked run state directly.

The project-local OpenCode plugin `.opencode/plugins/emergency-handoff-compaction.ts` uses the installed and type-verified `experimental.session.compacting` hook. It is only an emergency fallback and preserves the mandatory continuation fields.

Validation on OpenCode 1.18.25: the plugin compiles against the installed `@opencode-ai/plugin` declarations, and `opencode debug config` resolves it as a local plugin from the expected file URL. A forced live multi-model context-overflow run remains part of the final E2E/hardening milestone; deterministic tests currently prove multiple handoffs, mismatch escalation, independent counters, and the mutating-action guard.
