# Milestone 7 visual feedback

Milestone 7 adds an observational dashboard and structured local telemetry. It does not control workflow decisions, model routing, checkpoints, or merges. Failure to append an event is deliberately ignored by the workflow; dashboard and hardware collection execute only in status commands.

## Commands

```bash
harness status [run-id] --repo /absolute/project
harness status [run-id] --repo /absolute/project --json
harness status [run-id] --repo /absolute/project --no-tui
harness logs <run-id> --repo /absolute/project --follow
```

When `run-id` is omitted, `status` selects the lexicographically latest run directory. A TTY renders the Ink dashboard. `--no-tui` and redirected stdout emit exactly one JSON object per line; `--json` emits the same normalized snapshot in readable JSON. This makes IDE terminals, tasks, and log processors consume the same contract.

`events.jsonl` is append-only. The dashboard reads only the last 12 valid meaningful events; `logs` exposes the complete valid stream and `--follow` waits for additions until interrupted.

## Data shown

The snapshot contains run/branch/elapsed state, active role and exact model alias, request duration and measured output tokens per second when OpenCode provides exact token metadata, current/projected context and handoff reserve, gate baseline attribution, test provenance, review/triage/progress counts, mutation/flaky state, and machine metrics.

RAM and swap come from `/proc/meminfo`. NVIDIA metrics use `nvidia-smi` with a fixed executable and argv vector. Absence or failure of `nvidia-smi` produces `gpu: undefined`; it never fails the status command or workflow. The managed llama.cpp PID is read from the existing runtime state file.

## Validation

- Ink 7.1.1 and React 19.2.8 were verified against Node 24.20.0 and pinned in the lockfile.
- Unit tests verify all context-color boundaries, bounded/malformed JSONL handling, aggregation, and rendered AC-016 sections.
- Type checking, compilation, and the complete 19-file/50-test suite pass.

Live multi-sample hardware charts and crash/restart reconciliation remain outside this boundary; recovery belongs to Milestone 8.
