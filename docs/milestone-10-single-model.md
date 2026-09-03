# Milestone 10 — strict single-model residency

The harness must run the three role models sequentially because the target GPU cannot hold them together. A model change therefore uses a fail-closed barrier:

1. finish the active OpenCode response;
2. persist its response and complete any required handoff validation/bootstrap;
3. request unload of every loaded previous alias;
4. poll the router or process until unload/exit is confirmed;
5. poll `nvidia-smi` until VRAM is at or below `runtime.modelUnloadVramThresholdMiB`;
6. only then request the next model load and verify its alias and artifact identity.

`runtime.modelShutdownTimeoutMs` bounds unload, process/port release, and VRAM release. If the barrier times out, no next-model load is sent. The run fails, further mutation is blocked, and the evidence remains in its event log. The final active model goes through the same cleanup when a run succeeds, fails, pauses, escalates, or throws.

The handoff remains correct because `WorkflowEngine.invoke` waits for the model response, writes session/model state and response artifacts, and awaits `performHandoff`. That method keeps mutation blocked until the continuity adapter has written and validated the handoff and verified the new session bootstrap. Only after `invoke` returns can a later role call `ensureModel` and trigger an alias switch.

Tests cover delayed VRAM release ordering, refusal to issue the next load after release timeout, process exit/release before launch, prohibition while a request is active, and final workflow cleanup failure.
