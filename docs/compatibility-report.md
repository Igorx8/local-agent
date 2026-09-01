# Milestone 0 compatibility report

Observed on 2026-09-01. This report records facts from the local machine; it does not infer unavailable API fields.

| Capability | Result | Consequence |
|---|---|---|
| Node.js | 24.20.0 | Supported (minimum is 22) |
| npm | 11.19.0 | Supported for the foundation |
| Git | 2.55.0 | Supported |
| OpenCode executable/SDK | Not installed or not on `PATH` | SDK types, SSE shapes, and token metadata remain blocked until installation |
| llama.cpp server/router | Not installed or not on `PATH` | Health and unload behavior cannot yet be tested |
| NVIDIA | `nvidia-smi` installed, driver communication failed | GPU telemetry and VRAM release checks are blocked |
| GGUF artifacts | None found under `/home/igor` | Model fingerprinting behavior is implemented, but real identities are not available |

## Tooling decision

The harness itself uses Vitest. Project-specific baseline, coverage, property, mutation, and flaky-test tools must be discovered from each target repository in Milestones 2 and 5; the harness must not install or impose them silently.

## Unverified runtime questions

- Exact OpenCode SDK version and message/event token fields.
- Actual SSE event payloads and child-session behavior.
- llama.cpp router behavior with `--models-max 1` on the intended models.
- GPU memory stabilization and model unload behavior.

Run `npm run dev -- doctor --config config/harness.example.yaml --json` after installing/configuring those runtimes. The command reports unavailable integrations as blocked and never starts a model.
