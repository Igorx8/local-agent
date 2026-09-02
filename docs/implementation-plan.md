# Incremental implementation plan

- Milestone 0 — discovery and compatibility evidence. Supports AC-002, AC-003, AC-008, AC-039 by refusing to guess runtime/model identity.
- Milestone 1 — CLI, validated local-only configuration, atomic state, lock, structured logging/redaction, and doctor. Foundation for AC-017, AC-020–AC-023, AC-034, AC-039–AC-041.
- Milestone 2 — Git isolation, command policy, gates and baseline. Implemented primitives cover AC-005, AC-007, AC-019, AC-020, AC-024, AC-025 and AC-038; full workflow enforcement waits for Milestone 4.
- Milestone 3 — OpenCode and model lifecycle adapters. Implemented and live-validated with all production aliases in explicit and router modes for AC-002/AC-003 and AC-043–AC-050.
- Milestone 4 — bounded workflow and independent review. Implemented deterministic core for AC-001, AC-004–AC-006, AC-026 and AC-029–AC-034.
- Milestone 5 — regression/adversarial/property/mutation/flaky verification. Implemented normalized project adapters, fail-before/pass-after proof validation, acceptance-relevant mutant blocking, isolated flaky classification, provenance mapping, and append-only metrics for AC-027, AC-028, AC-031, AC-035–AC-037 and AC-041.
- Milestone 6 — context accounting and validated handoff. Implemented latest-prompt provenance, role turn projection, effective thresholds, mutating-action guard, deterministic/semantic handoff separation, validation retry, read-only bootstrap, persisted session relationships, manual requests, and emergency compaction fallback for AC-008–AC-015 and AC-042. Crash reconciliation remains Milestone 8 for AC-022.
- Milestone 7 — TUI and non-TTY observability. Implements AC-016–AC-018.
- Milestone 8 — recovery, E2E, security and reproducibility hardening. Completes AC-021–AC-023 and AC-039–AC-041.

Milestones 7–8 are intentionally not implemented yet.
