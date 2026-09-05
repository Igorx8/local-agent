# Milestone 5 advanced verification

Milestone 5 adds deterministic orchestration around project-specific verification tools. The harness does not infer a JavaScript, Python, Rust, or other test ecosystem from filenames and never treats an unavailable tool as a passing check.

## Normalized adapters

Configure adapters under `verification.commands` as executable plus argv. Shell strings and model-generated commands are rejected by the existing command policy.

- `adversarial` and `property` emit `{ "tests": [...] }`. Every test includes provenance, acceptance-criterion IDs, behavior partitions, changed-code paths, pass/fail, and concrete evidence.
- `mutation` emits counts for `killed`, `survived`, `timedOut`, and `skipped`, plus survivor records. Changed files are supplied in `HARNESS_CHANGED_FILES`. A survivor mapped to an acceptance criterion blocks success.
- `flaky` identifies one isolated suspect command. The harness repeats it `flakyRepetitions` times and classifies it as `stable_pass`, `stable_failure`, or `potentially_flaky`. Potentially flaky evidence cannot be the sole success evidence.
- `regression` receives findings and the exact defective/repaired commits in `HARNESS_REGRESSION_CONTEXT`. It must emit fail-before/pass-after proof for every testable confirmed finding, or a permitted structured exemption. Proofs referring to other commits are rejected.

Raw command output is retained in the run artifacts. Invalid JSON, wrong provenance, missing behavioral mappings, timeouts, and non-zero adapter exits become explicit failures rather than silently degraded evidence.

## Workflow and metrics

The core workflow now traverses `ADVERSARIAL_TESTING -> PROPERTY_TESTING -> MUTATION_TESTING -> FLAKY_ANALYSIS -> FINAL_AUDIT`. Results are stored in their corresponding artifact directories. Append-only historical JSONL records include first-pass gate status, final status, repairs, finding counts, provenance distribution, mutation score, flaky incidents, and duration.

An unconfigured optional challenge adapter is recorded as `skipped`. An unconfigured regression adapter is stricter: if a confirmed finding is testable, the run stops safely because AC-031 cannot be proven.

The bundled `harness regression-proof <command> [args...]` adapter materializes the defective and repaired commits in isolated temporary directories, overlays only test files changed by the repair onto the defective snapshot, and runs the configured executable plus argv against both states. It emits evidence only when the overlaid test fails before and the same configured command passes after; a test that was already green before the repair is rejected. Model-generated reproduction strings are never executed.
