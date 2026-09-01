# Milestone 3 live validation

Date: 2026-09-01

## Installed runtime

- OpenCode CLI and SDK: 1.18.25.
- llama.cpp: commit `3466812d1f06728effe7c0f3c0671117f461672d`, CUDA 13.3 build targeting RTX 50-series `sm_120`.
- User commands: `opencode`, `~/.local/bin/llama-server`, and `~/.local/bin/llama-cli`.
- Runtime source/build/model files are under ignored `.local-runtime/`; large artifacts are not committed.

## Smoke model

- Source: official `Qwen/Qwen2.5-0.5B-Instruct-GGUF` repository.
- File: `qwen2.5-0.5b-instruct-q4_k_m.gguf`.
- Size: 485452288 bytes.
- SHA-256: `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db`.

## Evidence

| Check | Result |
|---|---|
| llama.cpp `/health` and `/v1/models` | Passed |
| Direct CUDA inference | Returned exact `LOCAL_OK`; 35 prompt and 3 completion tokens |
| OpenCode config resolution | Accepted local-only provider and project agents |
| OpenCode SDK session/prompt | Returned exact `OPENCODE_LOCAL_OK` |
| SDK token provenance | Exact `AssistantMessage.tokens` including cache fields |
| SSE | Received native events; explicit `AbortSignal` required for clean shutdown |
| Session abort | API returned `true` |
| Router `--models-max 1` | Load, inference and unload passed; returned `ROUTER_OK` |
| Explicit process strategy | Startup, health/model verification, inference, captured logs and shutdown passed; returned `PROCESS_OK` |
| VRAM release | llama.cpp compute process disappeared after shutdown |

The live test discovered that returning from the SDK SSE iterator did not terminate its underlying connection. The adapter now accepts an `AbortSignal`, the smoke script aborts it explicitly, and a regression test covers signal propagation.

## Reproduction

With the local servers configured and running:

```bash
npm run build
node scripts/integration-smoke.mjs
node scripts/router-smoke.mjs
node scripts/process-smoke.mjs
```

These scripts are manual integration checks and intentionally remain outside the default unit-test gate because they require installed runtimes, a local model, network ports, and an NVIDIA GPU.

## Remaining risk

The 0.5B smoke model proves integration, not engineering quality. Before final E2E acceptance, select and fingerprint the three production role models and verify that each quantization fits the 16 GB VRAM budget one at a time.
