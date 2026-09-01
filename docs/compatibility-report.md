# Milestone 0 compatibility report

Observed and revalidated on 2026-09-01. This report records facts from the local machine; it does not infer unavailable API fields.

| Capability | Result | Consequence |
|---|---|---|
| Node.js | 24.20.0 | Supported (minimum is 22) |
| npm | 11.19.0 | Supported for the foundation |
| Git | 2.55.0 | Supported |
| OpenCode executable | 1.18.25, installed in the user's Node environment | Live session, prompt, SSE, token metadata, and abort verified |
| OpenCode SDK | `@opencode-ai/sdk` 1.18.25 | Typed session, prompt, async prompt, abort, status, children, todos, diffs, messages and SSE contracts verified |
| llama.cpp server/router | 0.3.0-dev, commit `3466812`, CUDA build for `sm_120` | Explicit process and router mode verified |
| NVIDIA | RTX 5060 Ti 16 GB, driver 595.84, CUDA toolkit 13.3 | GPU inference and VRAM release verified |
| GGUF smoke artifact | Qwen2.5 0.5B Instruct Q4_K_M, 485452288 bytes | SHA-256 `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` |

## Tooling decision

The harness itself uses Vitest. Project-specific baseline, coverage, property, mutation, and flaky-test tools must be discovered from each target repository in Milestones 2 and 5; the harness must not install or impose them silently.

## Remaining unverified runtime questions

- Child-session behavior with the final role models.
- Router switching among the three intended large models.
- VRAM fit, quality, and throughput of the final model quantizations.

The installed SDK exposes exact assistant usage at `AssistantMessage.tokens.input`, `output`, `reasoning`, and `cache`. The adapter records this as `opencode_message_metadata`. The live test confirmed these fields, SSE cancellation through `AbortSignal`, and successful session abort. Router load/inference/unload and explicit-process startup/inference/shutdown both released the smoke model's VRAM.

Run `npm run dev -- doctor --config config/harness.example.yaml --json` after installing/configuring those runtimes. The command reports unavailable integrations as blocked and never starts a model.
