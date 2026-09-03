# Spec: Local Multi-Agent Engineering Harness

Status: Consolidated Draft v1.2 for implementation
Revision date: 2026-09-02
Target implementer: Codex  
Primary environment: Ubuntu, NVIDIA RTX 5060 Ti 16 GB, 32 GB RAM  
Primary stack: TypeScript, Node.js 22+, OpenCode SDK, llama.cpp, Git

## 1. Purpose

Build a completely local orchestration harness that receives a software task and coordinates specialized local models through a controlled engineering workflow:

1. baseline validation;
2. requirements analysis and acceptance criteria;
3. independent oracle-test design;
4. planning and implementation;
5. deterministic quality gates;
6. independent repository and requirements reviews;
7. finding validation and focused repair;
8. adversarial, property-based, and focused mutation testing;
9. incremental re-review and final audit;
10. handoff to a new session when context pressure becomes unsafe.

The harness must operate without routine human intervention while preserving safety, reproducibility, Git history, visual feedback, and restartability.

The harness must not treat LLM opinions as the source of truth. Tests, lint, type checking, acceptance criteria, Git state, and explicit policies determine whether a run succeeds.

## 2. Goals

- Run all model inference locally through llama.cpp.
- Use OpenCode as the agent runtime, tool layer, session manager, and subagent interface.
- Assign a different local model to each engineering role.
- Load at most one large model at a time on the GPU.
- Establish baseline gate results before any model edits source code.
- Design independent oracle tests before the implementer sees the solution.
- Run an adaptive review/repair loop with bounded normal and extended limits.
- Require objective improvement before granting an additional repair iteration.
- Perform separate repository-risk and requirements-compliance reviews.
- Convert every confirmed defect into a permanent regression test.
- Apply adversarial, property-based, mutation, and flaky-test checks where configured.
- Display real-time progress, model state, context usage, gates, findings, time, and GPU/RAM metrics.
- Detect context pressure before overflow.
- At the effective safe context threshold, normally around 85%, generate a structured Markdown handoff, create a new session, validate the handoff, and continue automatically.
- Persist enough state to resume after process failure or machine restart.
- Pin model artifacts, runtime versions, prompts, sampling settings, and gate commands for reproducibility.
- Track historical quality and efficiency metrics by model, role, language, and task type.
- Never merge automatically into the default branch.

## 3. Non-goals

- Training or fine-tuning models.
- Hosting inference outside the local machine.
- Replacing the project's existing test strategy.
- Automatically resolving ambiguous product decisions.
- Granting arbitrary root, `sudo`, secret, or destructive filesystem access to an LLM.
- Keeping all large models simultaneously loaded in VRAM.
- Using a subjective numeric score as the only acceptance condition.

## 4. Model roles

| Role | Model alias | Main responsibility | Workspace permissions |
|---|---|---|---|
| Supervisor | `qwen36-main` | Coordinate stages, validate outputs, decide transitions | Read, controlled task delegation, no direct source edits |
| Planner | `qwen36-main` | Requirements, acceptance criteria, plan, risks | Read-only |
| Test architect | `qwen36-main` | Design implementation-independent acceptance and oracle tests in a fresh session | Read-only source access; write only to isolated oracle-test artifacts |
| Implementer | `qwen3-coder-impl` | Implement approved plan and tests | Read, edit, approved quality commands |
| Repository reviewer | `devstral-repo` | Repository navigation, integration, regression, scope, and maintainability review | Read-only and approved diagnostic commands |
| Requirements reviewer | `qwen36-main` | Independently compare implementation with requirements and acceptance criteria | Read-only, fresh session |
| Finding validator | `qwen36-main` | Confirm/reject reviewer findings against evidence | Read-only |
| Repair agent | `qwen3-coder-impl` | Fix confirmed findings only | Read, edit, approved quality commands |
| Adversarial verifier | Configurable, default `devstral-repo` | Generate evidence-driven edge cases and challenge tests | Read-only source; isolated test artifacts |
| Final auditor | `qwen36-main` | Compare final state against requirements | Read-only |

Roles must be configurable. No role name may be hard-coded into the state machine.

### 4.1 Installed model registry

The first implementation targets the three GGUF artifacts already installed and tested on this workstation. These identifiers are normative; Codex must not infer, shorten, or silently substitute a different repository, quantization, or alias.

| Stable alias | Exact Hugging Face reference | Approx. artifact size | Reasoning | Intended use |
|---|---|---:|---|---|
| `qwen36-main` | `unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_S` | 13.7 GB | `auto`, budget 8192 | Supervisor, planning, test architecture, requirements validation, finding validation, final audit |
| `qwen3-coder-impl` | `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL` | 17.7 GB | `off` | Initial implementation and focused repairs |
| `devstral-repo` | `bartowski/mistralai_Devstral-Small-2-24B-Instruct-2512-GGUF:Q4_K_S` | 13.55 GB | `off` | Repository review and adversarial verification |

The sizes above are identification hints, not integrity checks. During Milestone 0, `harness doctor` must resolve the actual cached GGUF path or shards and record their byte sizes and SHA-256 hashes. A mismatch must be reported; it must not trigger an automatic redownload or model replacement.

The canonical machine-readable registry must be stored in `config/models.local.yaml`, generated from `config/models.example.yaml`. At minimum it must preserve:

```yaml
version: 1
providerId: llama.cpp
baseUrl: http://127.0.0.1:8080/v1
apiKeyEnv: LLAMA_API_KEY

models:
  qwen36-main:
    hfRef: unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_S
    quantization: UD-IQ3_S
    approximateArtifactGiB: 13.7
    contextSize: 65536
    parallel: 1
    reasoning: auto
    reasoningBudget: 8192
    reasoningPreserve: true
    roles: [supervisor, planner, testArchitect, requirementsReviewer, validator, auditor]

  qwen3-coder-impl:
    hfRef: unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL
    quantization: UD-Q4_K_XL
    approximateArtifactGiB: 17.7
    contextSize: 65536
    parallel: 1
    reasoning: off
    roles: [implementer, repair]

  devstral-repo:
    hfRef: bartowski/mistralai_Devstral-Small-2-24B-Instruct-2512-GGUF:Q4_K_S
    quantization: Q4_K_S
    approximateArtifactGiB: 13.55
    contextSize: 65536
    parallel: 1
    reasoning: off
    roles: [repositoryReviewer, adversarialVerifier]

commonServerArgs:
  host: 127.0.0.1
  port: 8080
  noMmproj: true
  jinja: true
  flashAttention: auto
  cacheTypeK: q8_0
  cacheTypeV: q8_0
  fit: on
  fitTargetMiB: 2048
```

`LLAMA_API_KEY` is an environment-variable name, not a value to commit. The current local credential must be supplied outside the repository and redacted from logs.

### 4.2 Stable invocation contract

Every layer must use the same stable alias:

| Layer | Main model example |
|---|---|
| Harness registry and role mapping | `qwen36-main` |
| OpenCode model identifier | `llama.cpp/qwen36-main` |
| llama.cpp request body | `"model": "qwen36-main"` |
| Explicit-process `--alias` | `--alias qwen36-main` |
| TUI, state, logs, metrics, and handoff | `qwen36-main` |

The harness must never send a role name such as `planner` in the API `model` field. It must resolve `role -> stable alias -> active runtime model`. Before the first prompt of a stage, it must verify that `/v1/models` exposes the expected alias and that the returned runtime identity matches the registry manifest.

An OpenAI-compatible smoke call therefore looks like:

```bash
curl -sS http://127.0.0.1:8080/v1/chat/completions \
  -H "Authorization: Bearer $LLAMA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen36-main",
    "messages": [{"role": "user", "content": "Reply with exactly: ok"}],
    "temperature": 0,
    "max_tokens": 16
  }'
```

Replace only the JSON `model` value with `qwen3-coder-impl` or `devstral-repo` when that model is active. A request naming an inactive alias must cause the lifecycle manager to switch models first; it must not fall back to another model.

### 4.3 Exact explicit-process commands

The installed llama.app CLI uses `llama serve`. Milestone 0 must also detect whether a raw `llama-server` binary exists and encapsulate the difference in the process adapter. The following commands are the normative llama.app launch profiles.

Common prerequisite, kept out of shell history where practical. In Bash:

```bash
test -n "$LLAMA_API_KEY" || { echo "LLAMA_API_KEY is not set" >&2; exit 1; }
```

In the user's configured Fish shell:

```fish
set -qx LLAMA_API_KEY; or begin
    echo "LLAMA_API_KEY is not set" >&2
    exit 1
end
```

Main/supervisor model:

```bash
llama serve \
  -hf unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_S \
  --alias qwen36-main \
  --no-mmproj --host 127.0.0.1 --port 8080 \
  --api-key "$LLAMA_API_KEY" --cors-origins localhost \
  --ctx-size 65536 --parallel 1 --jinja \
  --reasoning auto --reasoning-budget 8192 --reasoning-preserve \
  --flash-attn auto --cache-type-k q8_0 --cache-type-v q8_0 \
  --fit on --fit-target 2048 --metrics
```

Implementation/repair model:

```bash
llama serve \
  -hf unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL \
  --alias qwen3-coder-impl \
  --no-mmproj --host 127.0.0.1 --port 8080 \
  --api-key "$LLAMA_API_KEY" --cors-origins localhost \
  --ctx-size 65536 --parallel 1 --jinja --reasoning off \
  --flash-attn auto --cache-type-k q8_0 --cache-type-v q8_0 \
  --fit on --fit-target 2048 --metrics
```

Repository-review model:

```bash
llama serve \
  -hf bartowski/mistralai_Devstral-Small-2-24B-Instruct-2512-GGUF:Q4_K_S \
  --alias devstral-repo \
  --no-mmproj --host 127.0.0.1 --port 8080 \
  --api-key "$LLAMA_API_KEY" --cors-origins localhost \
  --ctx-size 65536 --parallel 1 --jinja --reasoning off \
  --flash-attn auto --cache-type-k q8_0 --cache-type-v q8_0 \
  --fit on --fit-target 2048 --metrics
```

The process adapter must construct these commands as an argument array, never as an interpolated shell string. Before adopting a flag, `doctor` must compare it with the locally installed `llama serve --help`; version drift is an explicit compatibility failure or ADR, not permission to silently omit the setting.

### 4.4 Router preset generation

Router mode must retain the stable aliases. Because llama.cpp controls aliases for cached Hugging Face entries, `doctor` must resolve each installed artifact to an absolute local GGUF path and generate `config/models.local.ini`; it must not commit machine-specific absolute paths. The generated form is:

```ini
version = 1

[*]
ctx-size = 65536
parallel = 1
no-mmproj = true
jinja = true
flash-attn = auto
cache-type-k = q8_0
cache-type-v = q8_0
fit = on
fit-target = 2048
metrics = true
stop-timeout = 30

[qwen36-main]
model = /ABSOLUTE/RESOLVED/PATH/qwen36-main.gguf
reasoning = auto
reasoning-budget = 8192
reasoning-preserve = true

[qwen3-coder-impl]
model = /ABSOLUTE/RESOLVED/PATH/qwen3-coder-impl.gguf
reasoning = off

[devstral-repo]
model = /ABSOLUTE/RESOLVED/PATH/devstral-repo.gguf
reasoning = off
```

Launch the router with the locally supported server entry point equivalent to:

```bash
llama-server \
  --models-preset ./config/models.local.ini \
  --models-max 1 --models-autoload \
  --host 127.0.0.1 --port 8080 \
  --api-key "$LLAMA_API_KEY" --cors-origins localhost
```

The generated preset must be validated against the installed version. If a sharded artifact cannot be represented safely by a single resolved `model` path, router mode for that artifact must be marked unsupported and the explicit-process strategy used. Do not redownload, merge, or rewrite shards automatically.

### 4.5 OpenCode provider mapping

The generated local OpenCode configuration must map all three stable aliases to the same local OpenAI-compatible endpoint:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "enabled_providers": ["llama.cpp"],
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local llama.cpp",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1",
        "apiKey": "{env:LLAMA_API_KEY}"
      },
      "models": {
        "qwen36-main": {"name": "Qwen3.6 35B A3B UD-IQ3_S"},
        "qwen3-coder-impl": {"name": "Qwen3 Coder 30B A3B UD-Q4_K_XL"},
        "devstral-repo": {"name": "Devstral Small 2 24B Q4_K_S"}
      }
    }
  },
  "compaction": {
    "auto": false,
    "prune": true,
    "reserved": 10000
  }
}
```

Agent definitions then select exactly `llama.cpp/qwen36-main`, `llama.cpp/qwen3-coder-impl`, or `llama.cpp/devstral-repo` according to the role table. The configuration generator must merge these fields with project configuration without deleting unrelated user settings.

## 5. High-level architecture

Components:

1. **CLI and TUI**: starts runs, resumes runs, and renders live status.
2. **Workflow engine**: deterministic state machine controlling stage transitions.
3. **OpenCode adapter**: creates sessions, submits prompts, listens to events, obtains diffs, and invokes configured agents.
4. **Model lifecycle manager**: ensures the requested llama.cpp model is available and previous large models are unloaded.
5. **Git workspace manager**: creates an isolated branch/worktree and checkpoints each stage.
6. **Tool policy layer**: validates every executable command against project policy.
7. **Quality gate runner**: executes tests, lint, type checking, coverage, builds, or project-specific commands.
8. **Baseline comparator**: distinguishes pre-existing failures and dependencies from model-introduced changes.
9. **Oracle-test manager**: stores acceptance matrices and independent tests outside the implementation agent's initial context.
10. **Review engine**: merges, deduplicates, validates, and tracks findings from independent reviews.
11. **Progress evaluator**: determines whether another repair iteration is justified by objective improvement.
12. **Adversarial verification engine**: coordinates edge-case, property-based, mutation, and flaky-test analysis.
13. **Context budget manager**: estimates effective context pressure for every active session.
14. **Handoff manager**: generates, validates, stores, and injects continuation Markdown into a new session.
15. **Model manifest manager**: fingerprints model files, prompts, runtime versions, and sampling configuration.
16. **State store**: atomically persists workflow state and artifacts.
17. **Telemetry collector**: records local timing, token, memory, GPU, gates, review accuracy, and historical model metrics.

## 6. Technology choices

Use TypeScript because OpenCode provides an official TypeScript SDK and the user primarily works with TypeScript.

Recommended dependencies:

- `@opencode-ai/sdk`: OpenCode server/session/event integration;
- `zod`: runtime validation for configuration and model outputs;
- `execa`: controlled subprocess execution;
- `yaml`: YAML configuration;
- `ink` and `react`: terminal dashboard;
- `pino`: structured JSONL logging;
- `proper-lockfile` or an equivalent lock mechanism: single-run locking;
- `vitest`: unit and integration tests.

Avoid adding LangGraph, CrewAI, AutoGen, or another orchestration framework in the first implementation. The workflow is a bounded state machine and must remain inspectable.

## 7. Repository structure

```text
local-agent-harness/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── README.md
├── AGENTS.md
├── config/
│   ├── harness.example.yaml
│   ├── models.example.yaml
│   ├── models.local.yaml       # generated, ignored by Git
│   ├── models.local.ini        # generated router preset, ignored by Git
│   ├── opencode.example.json
│   └── command-policy.example.yaml
├── prompts/
│   ├── supervisor.md
│   ├── planner.md
│   ├── test-architect.md
│   ├── implementer.md
│   ├── repository-reviewer.md
│   ├── requirements-reviewer.md
│   ├── finding-validator.md
│   ├── repair.md
│   ├── adversarial-verifier.md
│   ├── final-auditor.md
│   └── handoff.md
├── schemas/
│   ├── plan.schema.json
│   ├── acceptance-matrix.schema.json
│   ├── oracle-tests.schema.json
│   ├── review.schema.json
│   ├── review-merge.schema.json
│   ├── triage.schema.json
│   ├── progress.schema.json
│   ├── audit.schema.json
│   └── handoff.schema.json
├── src/
│   ├── cli.tsx
│   ├── config.ts
│   ├── workflow/
│   │   ├── engine.ts
│   │   ├── states.ts
│   │   ├── transitions.ts
│   │   └── policies.ts
│   ├── opencode/
│   │   ├── client.ts
│   │   ├── sessions.ts
│   │   ├── events.ts
│   │   └── agents.ts
│   ├── models/
│   │   ├── manager.ts
│   │   ├── router-adapter.ts
│   │   └── process-adapter.ts
│   ├── git/
│   │   ├── workspace.ts
│   │   └── checkpoints.ts
│   ├── tools/
│   │   ├── executor.ts
│   │   ├── policy.ts
│   │   ├── gates.ts
│   │   ├── baseline.ts
│   │   ├── oracle.ts
│   │   ├── mutation.ts
│   │   └── flaky.ts
│   ├── review/
│   │   ├── merge.ts
│   │   ├── validate.ts
│   │   └── progress.ts
│   ├── context/
│   │   ├── budget.ts
│   │   ├── handoff.ts
│   │   └── validator.ts
│   ├── telemetry/
│   │   ├── metrics.ts
│   │   ├── nvidia.ts
│   │   ├── model-manifest.ts
│   │   ├── history.ts
│   │   └── logger.ts
│   ├── state/
│   │   ├── store.ts
│   │   └── migrations.ts
│   └── ui/
│       ├── dashboard.tsx
│       └── components/
└── tests/
    ├── unit/
    ├── integration/
    ├── fixtures/
    └── e2e/
```

## 8. Workflow state machine

Required states:

```text
CREATED
PREFLIGHT
BASELINE_CREATED
BASELINE_GATES_RUNNING
BASELINE_CAPTURED
ACCEPTANCE_CRITERIA_GENERATING
ACCEPTANCE_CRITERIA_VALIDATING
ORACLE_DESIGNING
ORACLE_VALIDATING
PLANNING
PLAN_VALIDATION
IMPLEMENTING
IMPLEMENTATION_CHECKPOINT
GATES_RUNNING
REPOSITORY_REVIEWING
REQUIREMENTS_REVIEWING
REVIEWS_MERGING
FINDINGS_VALIDATION
PROGRESS_EVALUATION
REPAIRING
REPAIR_CHECKPOINT
INCREMENTAL_REVIEW
ADVERSARIAL_TESTING
PROPERTY_TESTING
MUTATION_TESTING
FLAKY_ANALYSIS
FINAL_AUDIT
SUCCEEDED
FAILED
ESCALATED
PAUSED
HANDOFF_GENERATING
HANDOFF_VALIDATING
SESSION_RESTARTING
```

All transitions must be explicit and validated. Every transition must be persisted atomically before the next side effect starts.

The normal review loop is:

```text
GATES_RUNNING -> REPOSITORY_REVIEWING -> REQUIREMENTS_REVIEWING
-> REVIEWS_MERGING -> FINDINGS_VALIDATION -> PROGRESS_EVALUATION
```

If confirmed high/critical findings exist:

```text
PROGRESS_EVALUATION -> REPAIRING -> REPAIR_CHECKPOINT
-> GATES_RUNNING -> INCREMENTAL_REVIEW
```

Default `maxReviewIterations` is `3`. The workflow may extend to `adaptiveReviewMaximum: 5` only when the progress evaluator proves objective improvement. Reaching the applicable limit with unresolved high/critical findings produces `ESCALATED`, not an infinite loop.

The workflow must stop early when any of the following occurs:

- the same failure recurs twice for the same root cause;
- a repaired finding reappears;
- agents repeatedly undo each other's changes;
- the diff grows without improving required gates or acceptance-criterion coverage;
- two consecutive repair rounds produce no objective improvement;
- a repair introduces a new critical finding.

Inference retries, repair iterations, and context handoffs are separate counters. Malformed structured output, transient server failure, or model reload failure must not consume a repair iteration.

## 9. OpenCode integration

### 9.1 Runtime

Start or connect to a local OpenCode server bound to `127.0.0.1`. Do not expose it on the LAN by default.

The harness must use the official SDK where practical and the documented HTTP API only when an SDK method is unavailable.

Required capabilities:

- create parent and child sessions;
- submit synchronous and asynchronous prompts;
- select agent and model per request;
- subscribe to SSE events;
- read session status, messages, children, todos, and diffs;
- abort a stuck session;
- create a new session after handoff;
- show TUI notifications when a compatible OpenCode TUI is attached.

### 9.2 OpenCode local-only configuration

Generate the complete provider mapping defined in Section 4.5. Its local-only and compaction portion must include:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "share": "disabled",
  "autoupdate": false,
  "enabled_providers": ["llama.cpp"],
  "compaction": {
    "auto": false,
    "prune": true,
    "reserved": 10000
  }
}
```

Automatic compaction is disabled for the main managed sessions because the harness must produce an auditable handoff instead of relying on opaque in-session compression. A custom compaction hook must still be installed as an emergency fallback.

### 9.3 Agents

Create project-level OpenCode agent definitions for all roles. Each definition must specify:

- exact model alias;
- role description;
- structured output requirement;
- allowed and denied tools;
- no hidden delegation unless explicitly permitted;
- no source edits for planner/reviewer/auditor;
- maximum scope and stopping rules.

The supervisor may launch subagents. Subagents must not launch nested subagents unless explicitly configured.

## 10. llama.cpp model lifecycle

Implement two strategies behind the same interface.

### Strategy A: router mode

Use a llama.cpp preset file with:

- `--models-preset`;
- `--models-max 1`;
- `--models-autoload`;
- local host binding;
- API key loaded from environment or protected file;
- metrics enabled;
- one slot per large model workload.

The router preset and stable-alias mapping must be generated exactly as specified in Section 4.4.

Before a stage begins, request the required model and verify:

- router health;
- model is listed;
- model request succeeds;
- expected process exists;
- GPU memory stabilizes below configured safety limit.

When changing aliases, the sequence is strict: finish the active response, persist and validate any required handoff/session bootstrap, request unload, poll until the previous alias is reported unloaded, wait until VRAM is at or below `modelUnloadVramThresholdMiB`, and only then issue the next load request. Unload confirmation and VRAM release share `modelShutdownTimeoutMs`. A timeout must fail closed without issuing the next load request.

### Strategy B: explicit process management

Fallback if router unload behavior is unreliable. The manager must:

1. finish the current OpenCode request;
2. terminate the current llama.cpp child gracefully;
3. wait for port release and GPU memory release;
4. start the next model command;
5. poll `/health` with exponential backoff;
6. verify `/v1/models` contains the expected alias;
7. retry startup once;
8. fail safely with logs if the model cannot load.

The selected launch profile must come from the registry in Section 4.1 and produce the effective arguments in Section 4.3. Neither the workflow nor an LLM may invent a model command.

Never stop a model while an OpenCode response is still streaming.

The final model must also be unloaded when a run succeeds, fails, pauses, escalates, or throws. Failure to confirm final resource release changes the run to failed, blocks mutation, and is recorded in the event log. The handoff artifact remains durable and independent of the model process: model switching may occur only after the handoff response, deterministic validation, and bootstrap verification have completed.

## 11. Git safety and isolation

### Preflight

The harness must refuse autonomous execution when:

- the repository does not exist;
- Git is unavailable;
- the working tree is dirty, unless `allowDirtyWorktree` is explicitly enabled;
- the target branch is protected;
- another harness lock exists;
- the requested worktree path escapes the configured workspace root.

### Execution

- Create branch `agent/<run-id>-<slug>`.
- Prefer an isolated Git worktree.
- Record baseline commit and tree hash.
- Create checkpoint commits after initial implementation and each accepted repair.
- Store diff metadata after every checkpoint.
- Never force-push, reset hard, rewrite history, delete a branch, or merge to the default branch.
- On failure, preserve the worktree and emit recovery instructions.

## 12. Quality gates

Quality commands are project configuration, not model-generated arbitrary shell.

Example:

```yaml
quality:
  install: uv sync
  test: uv run pytest
  lint: uv run ruff check .
  typecheck: uv run mypy .
  coverage: uv run pytest --cov
  build: null
```

Node example:

```yaml
quality:
  install: npm ci
  test: npm test
  lint: npm run lint
  typecheck: npm run typecheck
  coverage: npm run test:coverage
  build: npm run build
```

Requirements:

- configurable timeout per gate;
- stdout/stderr captured separately;
- exit code and duration recorded;
- output size bounded with complete log stored on disk;
- no shell interpolation of untrusted LLM text;
- gates run in a deterministic order;
- a failed required gate blocks success;
- optional gates are clearly marked.

### 12.1 Baseline gates

Run all configured required gates before any model edits source code. Persist:

- baseline commit and tree hash;
- gate exit codes, durations, and relevant output;
- pre-existing test, lint, type, build, dependency, and coverage failures;
- environment fingerprint.

All later reports must compare final results with this baseline. A model must not be penalized for a dependency or failure already present at baseline unless its change worsens it.

### 12.2 Test provenance and oracle tests

Every test result must identify its provenance:

- `pre_existing`;
- `implementer_generated`;
- `oracle_independent`;
- `review_regression`;
- `adversarial`;
- `property_based`;
- `mutation_generated`.

The test architect must create an acceptance matrix and oracle-test plan from requirements and public contracts before inspecting the implementation diff. Oracle artifacts must initially be hidden from the implementer and revealed only after the first implementation checkpoint.

Test count is not coverage. The harness must map tests to acceptance criteria, behavior partitions, edge cases, and changed-code paths. Oracle tests and pre-existing contract tests have higher evidentiary weight than tests written by the implementation agent for its own code.

### 12.3 Regression tests for confirmed findings

For every confirmed defect that can be tested:

1. add a focused regression test;
2. demonstrate that the test fails against the defective checkpoint for the expected reason;
3. apply the repair;
4. demonstrate that the test passes;
5. retain the test permanently unless an explicit policy rejects it.

A repair without a regression test requires a structured justification such as documentation-only, non-testable infrastructure behavior, or externally constrained reproduction.

### 12.4 Adversarial, property-based, and mutation testing

After normal gates and confirmed repairs pass, run configured challenge verification:

- invalid and boundary inputs;
- state-transition failures;
- dependency and partial-failure behavior;
- concurrency or idempotency scenarios when relevant;
- property-based tests using project-appropriate tools such as Hypothesis or fast-check;
- focused mutation testing of changed production files using tools such as mutmut or Stryker.

Mutation testing must be scoped to changed or directly affected files by default. Record mutation score, surviving mutants, timeout, and skipped mutants. Surviving mutants affecting acceptance criteria block success or create explicit findings; unrelated survivors are reported but need not block.

### 12.5 Flaky-test detection

Do not repeatedly run a failing test until it happens to pass. When nondeterminism is suspected:

1. run the test in isolation;
2. repeat it a configured number of times, default `3`;
3. record every outcome and environment state;
4. classify it as stable failure, stable pass, or potentially flaky;
5. prevent a potentially flaky result from serving as the sole evidence for success or regression.

### 12.6 Scope and change-budget gates

Support configurable controls for:

- allowed and denied paths;
- maximum changed files and added lines before review is required;
- dependency changes;
- public API changes;
- database migrations;
- production configuration changes;
- unrelated refactors.

Exceeding a budget is not automatically a defect, but it requires evidence-based justification and an explicit scope finding.

## 13. Review findings contract

Each reviewer output must conform to a schema equivalent to:

```yaml
findings:
  - id: REV-001
    severity: critical | high | medium | low | info
    acceptanceCriterion: AC-003
    file: src/example.ts
    lineStart: 42
    lineEnd: 47
    problem: Concise defect description
    evidence: Concrete code or command evidence
    reproduction: Reproducible command or input
    expectedBehavior: Expected result
    actualBehavior: Actual result
    suggestedFix: Minimal repair direction
    confidence: high | medium | low
```

A finding is not automatically actionable. The finding validator must classify it as:

- `confirmed`;
- `invalid`;
- `style_preference`;
- `out_of_scope`;
- `requires_human_decision`.

Only `confirmed` findings are sent to the repair agent. Critical or high findings with `requires_human_decision` produce `ESCALATED`.

### 13.1 Independent dual review

Repository review and requirements review must execute in separate fresh sessions:

- the repository reviewer focuses on cross-file behavior, regressions, integration, scope, maintainability, and repository navigation;
- the requirements reviewer focuses on omissions, invented behavior, acceptance-criterion evidence, contract mismatches, and divergence from the approved plan.

The review engine must merge and deduplicate findings by root cause, affected contract, file region, and reproduction. Agreement increases confidence but never replaces evidence.

### 13.2 Objective progress evaluation

Before another repair iteration is granted, compare the current checkpoint with the previous one. Objective improvement includes:

- fewer required gate failures;
- fewer confirmed findings;
- reduced maximum finding severity;
- additional acceptance criteria proven;
- improved relevant coverage or mutation score;
- resolution of a reproducible defect without new regression;
- reduced diff churn while preserving correctness.

The progress evaluator returns structured output:

```yaml
decision: continue | stop_success | stop_stagnated | escalate
improvements: []
regressions: []
remainingConfirmedFindings: []
evidence: []
```

The deterministic engine verifies all claimed numeric changes before accepting the decision.

## 14. Context budget management

### 14.1 Principle

Conversation history must not be the source of truth. Durable workflow state, Git, structured artifacts, and gate results are authoritative. Sessions are disposable execution contexts.

Use a fresh child session for each major stage and each review iteration by default. Test architecture, implementation, repository review, requirements review, finding validation, repair, and final audit must not share an unbounded conversational history. This reduces context growth, prevents reviewer contamination, and isolates role-specific reasoning.

The workflow state, Git state, acceptance matrix, review artifacts, and gate evidence are authoritative. A new session receives only the validated artifacts needed for its role.

### 14.2 Context usage calculation

For every assistant response, record the latest input/prompt token count reported by the provider/OpenCode message metadata. Use the most recent request's input tokens as the best estimate of context currently submitted to the model.

Do not calculate context pressure by simply summing every historical message token count, because pruning, summarization, tool-output removal, and prompt reconstruction change the actual submitted context.

```text
contextUsage = latestPromptTokens / configuredContextWindow
```

Fallback order if direct usage is unavailable:

1. OpenCode message/event token metadata;
2. llama.cpp request usage or metrics for the active slot;
3. local tokenization using the active model tokenizer;
4. conservative byte/token estimate with a visible `estimated` flag.

Every displayed context percentage must be marked `exact` or `estimated`.

### 14.3 Thresholds

Defaults:

```yaml
context:
  warningThreshold: 0.70
  prepareHandoffThreshold: 0.78
  handoffThreshold: 0.85
  hardStopThreshold: 0.92
  reservedTokens: 8192
  maxHandoffTokens: 6000
```

Effective handoff threshold:

```text
min(handoffThreshold, 1 - reservedTokens / configuredContextWindow)
```

The lower default handoff threshold protects reasoning quality before the technical context limit is reached. It may trigger earlier when the configured reserve or projected next turn requires it.

At warning threshold, the dashboard turns yellow. At preparation threshold, the harness begins assembling deterministic state. At effective handoff threshold, no new implementation tool call may start. At hard stop, the current request is aborted if safe and the session is marked for recovery.

### 14.4 Projected overflow

Trigger handoff before the nominal threshold when:

```text
latestPromptTokens + expectedNextTurnBudget + reservedTokens >= contextWindow
```

`expectedNextTurnBudget` must be configurable by role and based on recent turn sizes.

The dashboard must separately show current usage, projected next-turn usage, reserve, and the exact threshold that caused a handoff.

## 15. Automatic Markdown handoff

### 15.1 Trigger

Handoff is triggered by:

- context threshold;
- projected overflow;
- explicit stage policy;
- model/tool failure caused by context size;
- manual `harness handoff` command.

### 15.2 Handoff file

Write:

```text
.agent-harness/runs/<run-id>/handoffs/<sequence>-<role>-handoff.md
```

Required sections:

```markdown
# Session Handoff

## Identity
- Run ID
- Previous session ID
- New session role
- Workflow stage and iteration

## Objective
- Original task in concise form
- Definition of done

## Current status
- Completed work
- In-progress work
- Not started

## Acceptance criteria
- ID, requirement, status, evidence

## Decisions and rationale
- Only decisions that constrain future work

## Repository state
- Repository/worktree path
- Branch
- Baseline commit
- Current commit
- Dirty state

## Runtime and model identity
- OpenCode and llama.cpp versions
- Model alias, GGUF hash, size, quantization, context, sampling settings, and prompt version

## Files changed
- File path and semantic purpose; do not paste full files

## Validation evidence
- Gate command, result, duration, relevant failure summary

## Review state
- Confirmed findings
- Rejected findings and why
- Unresolved findings

## Constraints and non-goals
- Security, scope, architecture, compatibility

## Exact next actions
- Ordered, executable continuation steps

## References
- Paths to plans, reviews, logs, diffs, and state artifacts
```

The handoff must contain the minimum sufficient semantic state, not a transcript dump. Large logs, source files, and tool outputs must be referenced by path and summarized.

### 15.3 Generation

Generation has two inputs:

1. deterministic state assembled by the harness;
2. an LLM abstraction pass using the role's handoff prompt.

The LLM may summarize and connect facts but must not change deterministic fields such as commits, paths, gate results, finding status, or iteration number.

### 15.4 Validation

Before starting the next session, validate:

- required headings exist;
- file is within token and byte limits;
- run ID, stage, role, branch, and commits match `state.json`;
- referenced artifact paths exist;
- Git state matches the handoff;
- every confirmed unresolved finding is included;
- every failed required gate is included;
- model and runtime identity matches the run manifest;
- exact next action is non-empty;
- no secret value or `.env` content is present.

If validation fails, regenerate once. A second failure produces `ESCALATED`.

### 15.5 New-session bootstrap

1. Create a new OpenCode session, linked to the previous session when supported.
2. Inject the validated handoff as the first context message.
3. Ask the new agent to verify repository state read-only.
4. Ask the new agent to restate the objective, completed work, pending acceptance criteria, allowed files, prohibited actions, and exact next step.
5. Compare both repository verification and semantic restatement with deterministic state.
6. Continue only if verification matches.
7. Regenerate the handoff once when verification fails; a second failure escalates.
8. Persist the old/new session relationship in `state.json`.

The previous session remains available for audit but receives no further work.

### 15.6 Emergency compaction fallback

Install an OpenCode `experimental.session.compacting` plugin that instructs emergency compaction to preserve:

- task and current stage;
- acceptance criteria status;
- active files;
- Git commits and branch;
- decisions;
- gate failures;
- unresolved findings;
- exact next action.

This is a fallback only. Normal managed sessions should hand off before automatic compaction is required.

## 16. Visual feedback

Implement an Ink-based terminal dashboard. It must work in a normal terminal and degrade to plain logs when stdout is not a TTY.

Required dashboard sections:

### Run header

- run ID;
- repository and branch;
- elapsed time;
- workflow stage;
- current review iteration;
- overall status.

### Active model

- role;
- model alias;
- lifecycle state: stopped, loading, healthy, generating, unloading, error;
- request duration;
- tokens per second when available.

### Context gauge

- latest prompt tokens;
- context window;
- percentage;
- exact or estimated marker;
- threshold color:
  - green below 70%;
  - yellow from 70%;
  - orange from 78%;
  - red from 85%;
  - critical indicator from 92%.

### Quality gates

- name;
- running/passed/failed/skipped;
- duration;
- exit code.
- baseline versus current result;
- test provenance;
- relevant coverage and mutation score;
- stable/flaky classification when applicable.

### Review

- total findings;
- counts by severity;
- confirmed/rejected/unresolved counts;
- repair iteration.
- objective improvement since previous iteration;
- reason another iteration was granted or denied;
- findings grouped by repository review and requirements review.

### Machine metrics

- GPU utilization;
- VRAM used/total;
- GPU temperature and power;
- system RAM and swap;
- active llama.cpp PID.

### Event feed

- last bounded set of meaningful events;
- model load/unload;
- agent start/end;
- checkpoint;
- gate result;
- handoff generation;
- session restart;
- warnings/errors.

Also support:

```bash
harness status --json
harness logs --follow
harness status --no-tui
```

The TUI is observational. Workflow correctness must not depend on the UI being open.

### 16.1 Conversational workspace session

A conversation is a user-facing sequence of workflow runs in one Git workspace. It is not a single shared model session. Each prompt is a new turn with fresh role sessions, independent reviewers, gates, checkpoints, and artifacts. This preserves review independence while giving the user continuous project memory.

Persist conversations under `.agent-harness/conversations/<conversation-id>/` with:

- `conversation.json`: schema version, workspace identity, status, timestamps, active turn, and ordered run/commit relationships;
- `memory.json`: bounded recent-turn facts and a deterministic compacted summary;
- `events.jsonl`: user-turn lifecycle events.

The first turn branches from the repository's current commit. Each later turn must branch from the exact final commit of the previous successful turn. The harness must verify that the recorded commit still exists and matches the previous run state before creating another worktree. It must never merge the conversation into the default branch automatically.

Conversation memory contains user prompts, outcome summaries, decisions, commits, unresolved blockers, and artifact paths. Keep at most the configured number of recent turns verbatim. Compact older turns deterministically into factual one-line entries; do not ask a model to rewrite commit identities or other deterministic fields. Enforce a byte limit after compaction and fail closed if bounded memory cannot be produced.

`harness chat` starts or resumes an interactive TTY loop. `harness continue [conversation-id] <prompt>` executes exactly one turn and emits structured output. If the conversation ID is omitted, use the latest active conversation for the current workspace; create one only when no conversation exists. EOF exits chat without changing workflow state. `/status`, `/memory`, and `/exit` are read-only chat commands.

## 17. Persistence and artifacts

Per-run structure:

```text
.agent-harness/runs/<run-id>/
├── state.json
├── config.snapshot.yaml
├── requirements.md
├── acceptance-criteria.json
├── baseline.json
├── model-manifest.json
├── plan.json
├── oracle-tests.json
├── sessions.json
├── checkpoints.json
├── historical-metrics.json
├── metrics.jsonl
├── events.jsonl
├── gates/
├── reviews/
├── adversarial/
├── mutation/
├── flaky-analysis/
├── handoffs/
├── prompts/
├── responses/
└── logs/
```

Requirements:

- atomic write using temporary file plus rename;
- schema version in state;
- file lock for active run;
- state migration mechanism;
- no secrets stored in artifacts;
- prompt/response storage configurable for privacy;
- deterministic identifiers for stages and iterations.
- immutable model/runtime fingerprint for reproducibility;
- test provenance and acceptance-criterion mapping;
- historical metrics stored outside transient session context.

### 17.1 Model and runtime manifest

For every role invocation, record:

- configured provider/model alias;
- resolved GGUF path reference, file size, and cryptographic hash;
- quantization and context metadata when discoverable;
- llama.cpp and OpenCode versions;
- prompt file hash;
- sampling parameters and fixed seed when supported;
- tool and permission profile hash;
- quality command configuration hash.

Do not copy GGUF files into run artifacts. Store identity and references only. Full GGUF hashing may be expensive; cache verified hashes keyed by canonical path, size, modification time, and inode/device identity, and recompute whenever those attributes change.

### 17.2 Historical consistency metrics

Maintain append-only aggregate records by model, role, language, repository profile, and task type:

- first-pass gate success;
- final success;
- repair iterations;
- confirmed, invalid, duplicate, and escaped findings;
- regressions introduced;
- test provenance distribution;
- relevant coverage and mutation score;
- flaky-test incidents;
- diff size and churn between checkpoints;
- wall time, prompt/completion tokens, tokens per second, VRAM/RAM peaks;
- tool-call failures, model reload failures, handoffs, and human interventions.

Historical metrics inform future routing but must not silently change routing policy. Policy changes require an explicit versioned configuration update.

## 18. Security policy

- Bind OpenCode and llama.cpp to `127.0.0.1` by default.
- Require API credentials from environment variables or protected files.
- Disable OpenCode sharing.
- Deny reading `.env`, SSH keys, browser profiles, credential stores, and configured secret patterns.
- Deny `sudo`, `su`, destructive recursive deletion, raw disk tools, package-manager removal, destructive Git history operations, and writes outside the worktree.
- Do not interpolate LLM output into a shell string.
- Execute only configured quality commands and typed custom tools.
- Redact secret-looking values from logs and handoffs.
- Preserve all material work on failure.

## 19. Configuration example

```yaml
version: 1

runtime:
  opencodeUrl: http://127.0.0.1:4096
  llamaUrl: http://127.0.0.1:8080
  modelStrategy: router
  modelStartupTimeoutMs: 600000
  modelShutdownTimeoutMs: 30000
  modelUnloadVramThresholdMiB: 2048
  localOnly: true

modelRegistry: ./config/models.local.yaml
routerPreset: ./config/models.local.ini
apiKeyEnv: LLAMA_API_KEY

models:
  supervisor: llama.cpp/qwen36-main
  planner: llama.cpp/qwen36-main
  testArchitect: llama.cpp/qwen36-main
  implementer: llama.cpp/qwen3-coder-impl
  repositoryReviewer: llama.cpp/devstral-repo
  requirementsReviewer: llama.cpp/qwen36-main
  validator: llama.cpp/qwen36-main
  repair: llama.cpp/qwen3-coder-impl
  adversarialVerifier: llama.cpp/devstral-repo
  auditor: llama.cpp/qwen36-main

workflow:
  maxReviewIterations: 3
  adaptiveReviewMaximum: 5
  inferenceRetries: 2
  requireObjectiveProgress: true
  stopAfterConsecutiveStagnantIterations: 2
  autoCommitCheckpoints: true
  autoMerge: false
  stopOnAmbiguousCriticalFinding: true
  requireRegressionTestForConfirmedDefect: true

verification:
  captureBaseline: true
  designOracleTestsBeforeImplementation: true
  hideOracleTestsUntilInitialCheckpoint: true
  dualIndependentReview: true
  propertyTesting: auto
  mutationTesting: changed-files
  flakyRepetitions: 3

scope:
  allowedPaths: []
  deniedPaths: []
  maxChangedFilesBeforeReview: 20
  maxAddedLinesBeforeReview: 800
  requireDependencyChangeJustification: true
  requirePublicApiChangeJustification: true
  requireMigrationJustification: true
  denyUnrelatedRefactors: true

context:
  warningThreshold: 0.70
  prepareHandoffThreshold: 0.78
  handoffThreshold: 0.85
  hardStopThreshold: 0.92
  reservedTokens: 8192
  maxHandoffTokens: 6000

sampling:
  planner: { temperature: 0.2 }
  testArchitect: { temperature: 0.1 }
  implementer: { temperature: 0.1 }
  repositoryReviewer: { temperature: 0.0 }
  requirementsReviewer: { temperature: 0.0 }
  validator: { temperature: 0.0 }
  repair: { temperature: 0.1 }
  adversarialVerifier: { temperature: 0.1 }
  auditor: { temperature: 0.0 }

reproducibility:
  fingerprintModelFiles: true
  recordRuntimeVersions: true
  recordPromptHashes: true
  recordGateCommands: true
  fixedSeedWhenSupported: true

telemetry:
  tui: true
  jsonLogs: true
  sampleHardwareEveryMs: 2000
  storePrompts: true
  storeResponses: true
  historicalModelMetrics: true
  metricsByRoleLanguageAndTaskType: true

conversation:
  maxRecentTurns: 8
  maxMemoryBytes: 32768

git:
  requireCleanWorktree: true
  useIsolatedWorktree: true
  branchPrefix: agent/
  defaultBranchProtection: true
```

## 20. CLI contract

Required commands:

```bash
harness doctor
harness init
harness run --repo <path> --requirements <file>
harness resume <run-id>
harness status [run-id]
harness logs <run-id> --follow
harness model list
harness model status
harness model start <qwen36-main|qwen3-coder-impl|devstral-repo>
harness model switch <qwen36-main|qwen3-coder-impl|devstral-repo>
harness model smoke <qwen36-main|qwen3-coder-impl|devstral-repo>
harness model stop
harness handoff <run-id>
harness abort <run-id>
harness report <run-id>
harness chat [conversation-id]
harness continue [conversation-id] <prompt>
```

`model start` and `model switch` accept only registry aliases, resolve the corresponding exact artifact and launch profile, and block until identity and health checks pass. `model smoke` performs a minimal completion and a tool-call capability check without granting repository write access. Normal autonomous runs invoke these same lifecycle operations internally; these commands exist for diagnostics and visual/manual verification.

`doctor` must validate:

- Node and package runtime;
- Git;
- OpenCode server and SDK compatibility;
- llama.cpp health;
- configured model aliases;
- model switching/unloading behavior;
- NVIDIA telemetry availability;
- repository command policy;
- context usage visibility and whether it is exact or estimated.

Suggested exit codes:

- `0`: success;
- `2`: invalid configuration;
- `3`: preflight failure;
- `4`: model/runtime failure;
- `5`: quality gate failure after maximum attempts;
- `6`: safety escalation;
- `7`: handoff/recovery failure.

## 21. Failure and recovery behavior

- Every long-running stage has timeout, cancellation, and persisted start state.
- On restart, reconcile `state.json`, Git, OpenCode session state, llama.cpp process state, and filesystem artifacts.
- Never assume a stage completed only because it started.
- Idempotent stages may retry automatically once.
- Editing stages require Git reconciliation before retry.
- A model crash preserves its request and logs and may retry once after a clean reload.
- A gate timeout kills only the gate process group, not the entire harness.
- Ctrl+C requests graceful pause first; a second Ctrl+C aborts while preserving state.

## 22. Acceptance criteria

### Core orchestration

- AC-001: A single CLI command can execute planning, implementation, gates, review, repair, and final audit.
- AC-002: Each role uses the configured model alias.
- AC-003: At most one configured large model is loaded at a time.
- AC-004: The workflow cannot exceed the configured repair iteration limit.
- AC-005: A failed required gate prevents success.
- AC-006: Reviewer findings require validation before repair.
- AC-007: The harness never merges into the default branch.

### Context and handoff

- AC-008: Context usage is displayed with exact/estimated provenance.
- AC-009: A handoff is triggered at the effective configured threshold or projected overflow.
- AC-010: No new mutating model action begins after handoff triggering.
- AC-011: The generated Markdown contains every required section.
- AC-012: Deterministic fields in the handoff match state and Git.
- AC-013: A new session receives the handoff and verifies repository state before continuing.
- AC-014: A run can cross at least two handoffs and still complete successfully.
- AC-015: Emergency compaction preserves the mandatory continuation fields.

### Visual feedback

- AC-016: The TUI shows stage, model, context, gates, review counts, elapsed time, GPU, VRAM, and RAM.
- AC-017: Non-TTY execution emits structured logs without corrupting output.
- AC-018: UI failure does not stop or alter workflow execution.

### Safety and recovery

- AC-019: Dirty worktree is rejected by default.
- AC-020: Denied commands cannot execute even in autonomous mode.
- AC-021: Secrets are redacted from logs and handoffs.
- AC-022: Killing and restarting the harness resumes from the last consistent state.
- AC-023: Failed runs preserve worktree, commits, diffs, and recovery instructions.

### Baseline, testing, and review consistency

- AC-024: All configured required gates run before the first source edit and their results are persisted as baseline evidence.
- AC-025: Final reports distinguish pre-existing failures from implementation-introduced failures.
- AC-026: Oracle acceptance tests are designed from requirements before the implementation diff is visible to the test architect.
- AC-027: Every executed test has recorded provenance and, where applicable, an acceptance-criterion mapping.
- AC-028: Test count alone is never reported as behavioral coverage.
- AC-029: Repository review and requirements review run in separate fresh sessions and produce independently attributable findings.
- AC-030: Findings are merged and deduplicated without treating model agreement as proof.
- AC-031: Every testable confirmed defect receives a regression test proven to fail before and pass after repair, or a structured exemption.

### Adaptive loop and advanced verification

- AC-032: A repair iteration beyond the normal limit is granted only after deterministic evidence of objective improvement.
- AC-033: The loop stops after configured stagnation, repeated root cause, repair oscillation, or new critical regression.
- AC-034: Inference retries, repair iterations, and context handoffs are counted independently.
- AC-035: Configured adversarial and property-based checks execute after normal gates pass.
- AC-036: Focused mutation testing records score and surviving relevant mutants for changed production code.
- AC-037: Suspected flaky tests are classified through isolated repeated execution and cannot serve as sole success evidence.
- AC-038: Scope, dependency, public API, migration, and unrelated-refactor policy violations produce explicit evidence and cannot pass silently.

### Reproducibility and learning

- AC-039: Every run records model GGUF hash, size, alias, quantization metadata when available, runtime versions, context, sampling configuration, prompt hashes, and gate commands.
- AC-040: A run can be reconstructed from its configuration snapshot, model manifest, Git baseline, prompts, and artifact references.
- AC-041: Historical metrics record first-pass success, repair count, confirmed and invalid findings, regressions, diff churn, gate results, mutation score, duration, token usage, handoffs, and human interventions where available.
- AC-042: The handoff bootstrap verifies both repository state and semantic understanding before continuing.

### Installed-model identity and invocation

- AC-043: The model registry contains the exact three Hugging Face references, quantizations, stable aliases, context settings, reasoning modes, and role mappings defined in Section 4.1.
- AC-044: OpenCode, llama.cpp requests, persisted state, telemetry, and handoffs use the same stable alias for a model.
- AC-045: `doctor` resolves and fingerprints every installed GGUF artifact and refuses silent model or quantization substitution.
- AC-046: Explicit-process mode starts each model with the effective launch profile defined in Section 4.3 and verifies the alias through `/v1/models` plus a smoke completion.
- AC-047: Router mode exposes the three stable aliases, keeps at most one large model loaded, and demonstrably switches between all three aliases; otherwise the harness falls back safely to explicit-process mode.
- AC-048: Each OpenCode role selects the exact `llama.cpp/<stable-alias>` identifier defined by the role mapping.
- AC-049: API credentials are obtained through `LLAMA_API_KEY`, are never committed, and are redacted from process logs, state, reports, and handoffs.
- AC-050: Unknown, inactive, mismatched, or unavailable model aliases fail closed and never route to a default model.

### Conversational workspace sessions

- AC-051: A user can submit multiple prompts to one persistent workspace conversation.
- AC-052: Every prompt creates a separately auditable workflow run and never overwrites artifacts from an earlier turn.
- AC-053: A successful next turn starts from the exact commit produced by the previous successful turn, without merging into the default branch.
- AC-054: Conversation memory records user intent, run outcome, commit identity, decisions, and artifact references without storing an unbounded transcript.
- AC-055: Conversation memory has deterministic size/turn limits and compacts older turns into a bounded summary before overflow.
- AC-056: Repository and requirements reviewers still use fresh independent model sessions on every conversational turn.
- AC-057: A failed, paused, escalated, dirty, or Git-mismatched previous turn fails closed and requires recovery before another mutating prompt.
- AC-058: `harness chat` works interactively in a TTY, while `harness continue` accepts one prompt non-interactively for IDE tasks and scripts.

### Strict single-model residency

- AC-059: A different model is never loaded until the previous alias is reported unloaded and VRAM is below the configured threshold.
- AC-060: Resource-release timeout fails closed without sending a load request for the next model, and the final model is unloaded on every workflow exit path.
- AC-061: A context handoff is persisted, validated, and bootstrapped before the lifecycle manager may unload the model that produced it.

## 23. Test plan

### Unit tests

- every valid and invalid state transition;
- normal and adaptive review iteration limits;
- progress and stagnation decisions;
- finding schema and classifications;
- review deduplication and evidence preservation;
- test provenance and acceptance-criterion mapping;
- baseline versus current result attribution;
- scope and diff-budget policies;
- mutation-result classification;
- flaky-test classification;
- context percentage and projected overflow calculations;
- handoff section and deterministic-field validation;
- atomic state writes and locks;
- command allow/deny matching;
- secret redaction;
- model lifecycle state transitions;
- model-registry validation, role-to-alias resolution, and rejection of unknown aliases;
- generation of explicit command argument arrays and router presets from registry fixtures;
- TUI reducers independent of rendering.

### Integration tests

- temporary Git repository with isolated worktree;
- fake OpenCode server with SSE event fixtures;
- fake llama.cpp endpoints with model loading delays and failures;
- fake `/v1/models` responses covering correct alias, wrong artifact, missing alias, and silent-fallback attempts;
- passing, failing, and timed-out quality gates;
- model switch while GPU release is delayed;
- context threshold causing new-session bootstrap;
- crash between stage start and completion;
- invalid LLM JSON followed by one repair attempt.
- baseline with known pre-existing failures followed by a clean implementation diff;
- hidden oracle-test reveal after initial checkpoint;
- dual reviews producing duplicate and conflicting findings;
- three improving repair iterations followed by one adaptive extension;
- two stagnant iterations causing early stop;
- changed-file mutation testing with relevant and irrelevant survivors;
- deterministic and flaky test fixtures;
- handoff semantic-restatement mismatch followed by regeneration.

### End-to-end tests

1. Small Python task with `pytest`, `ruff`, and `mypy`.
2. Small TypeScript task with tests, lint, type checking, and build.
3. Task intentionally producing a reviewer finding and one repair cycle.
4. Task where the implementer's own tests pass but an independent oracle test fails.
5. Task producing a confirmed defect, failing regression test, repair, and passing regression test.
6. Task with property-based edge cases and focused mutation testing.
7. Task with a deliberately flaky test to verify classification.
8. Forced low context window to trigger and semantically validate handoff quickly.
9. Full local run using the three configured GGUF models.
10. Sequential smoke run proving `qwen36-main -> qwen3-coder-impl -> devstral-repo -> qwen36-main`, with only one loaded model and the expected alias recorded for every response.

## 24. Implementation milestones

### Milestone 0: discovery spike

- Inspect installed OpenCode and llama.cpp versions.
- Verify the installed server entry points (`llama serve` and, if present, `llama-server`) and compare every required launch flag with local `--help` output.
- Confirm actual SDK message token fields and SSE event shapes.
- Confirm router model switching and unloading on this machine.
- Resolve the three exact Hugging Face references in Section 4.1 to their cached GGUF path or shards and calculate reproducible fingerprints without duplicating model data.
- Generate and validate the local model registry, router preset, OpenCode provider mapping, and role-to-alias resolution.
- Smoke-call each stable alias and prove tool calling for every model assigned to an agentic role.
- Identify project-appropriate property, mutation, coverage, and flaky-test capabilities.
- Record compatibility decisions; do not guess undocumented runtime fields.

### Milestone 1: foundation

- CLI skeleton, config schemas, logging, state store, locks, and `doctor`.

### Milestone 2: Git and gates

- worktree isolation, checkpoints, command policy, baseline capture/comparison, gate runner, scope policies, and fixtures.

### Milestone 3: OpenCode and model lifecycle

- SDK adapter, sessions/events, router adapter, explicit process fallback.

### Milestone 4: core workflow

- acceptance criteria, test architect, hidden oracle artifacts, planner, implementer, dual independent reviewers, review merge, validator, repair, auditor, objective progress evaluator, and adaptive bounded loop.

### Milestone 5: advanced verification

- regression-test proof, adversarial verification, property-based adapters, focused mutation testing, flaky-test classification, and historical quality metrics.

### Milestone 6: context continuity

- token provenance, thresholds, projected overflow, handoff generation, validation, and session restart.

### Milestone 7: visual feedback

- TUI, machine telemetry, baseline/current comparisons, test provenance, progress deltas, mutation/flaky state, logs, and non-TTY mode.

### Milestone 8: hardening

- recovery, security tests, E2E runs, reproducibility validation, documentation, and benchmark report.

### Milestone 9: conversational workspace sessions

- persistent conversation state above individual workflow runs;
- interactive `chat` and non-interactive `continue` commands;
- one immutable run per user turn;
- next-turn branches based on the previous successful checkpoint commit;
- bounded semantic memory with deterministic compaction and artifact references;
- fail-closed recovery and Git identity checks between turns;
- TTY and non-TTY behavioral tests for AC-051–AC-058.

### Milestone 10: strict single-model residency

- ordered response/handoff completion before model unload;
- explicit router unload polling before the next load;
- fail-closed VRAM threshold and shutdown timeout;
- final model cleanup on every workflow exit path;
- delayed-release and no-next-load tests for AC-059–AC-061.

Each milestone must leave the repository testable and committed. Codex must not implement all milestones as one unreviewable change.

## 25. Required implementation discipline for Codex

1. Begin with Milestone 0 and report discovered versions and API shapes.
2. Produce an implementation plan mapped to acceptance criteria.
3. Keep changes milestone-scoped and create small commits.
4. Add tests before or with every behavior.
5. Do not invent SDK fields; inspect installed types or the local OpenAPI document.
6. Do not invent, rename, or substitute model aliases, Hugging Face references, quantizations, or server flags; validate them against Section 4 and the installed runtime.
7. Prefer documented OpenCode APIs and llama.cpp endpoints.
8. Use adapters for unstable or version-dependent behavior.
9. Never weaken safety checks merely to make an E2E test pass.
10. Record deviations from this spec in an ADR.
11. Stop and request a decision only for destructive, security-sensitive, or materially ambiguous choices.
12. Never use test quantity as a proxy for behavioral coverage.
13. Never allow a model to validate its own implementation without independent evidence.
14. Do not grant an additional repair iteration without deterministic progress evidence.
15. Preserve failed checkpoints long enough to prove regression tests fail before repairs.
16. Keep oracle tests isolated from the initial implementation session.
17. Pin and report runtime, model, prompt, sampling, and gate identities for every E2E result.

## 26. Initial Codex prompt

```text
Implement the Local Multi-Agent Engineering Harness described in this specification.

Start only with Milestone 0 and Milestone 1. Do not implement later milestones yet.

First:
1. inspect the installed OpenCode, llama.cpp, Node, Git, and NVIDIA environment;
2. verify the local OpenCode OpenAPI/SDK types instead of assuming undocumented fields;
3. verify how token usage is exposed;
4. verify whether llama.cpp router mode unloads the previous model with models-max=1;
5. locate and fingerprint these exact installed artifacts without copying them:
   - qwen36-main = unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_S;
   - qwen3-coder-impl = unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL;
   - devstral-repo = bartowski/mistralai_Devstral-Small-2-24B-Instruct-2512-GGUF:Q4_K_S;
6. validate the Section 4 launch profiles against the installed CLI and smoke-call every alias;
7. identify available baseline, property-based, mutation, coverage, and flaky-test tooling;
8. produce a short compatibility report and an implementation plan mapped to AC IDs.

Then implement the project foundation: CLI skeleton, validated configuration, atomic state store, structured logging, run locking, and the doctor command. Add unit tests and documentation.

Constraints:
- local-only;
- no cloud providers;
- no automatic merge;
- no destructive Git commands;
- no hard-coded secrets;
- no arbitrary execution of LLM-generated shell;
- small, reviewable commits;
- prepare the configuration schemas for baseline evidence, oracle-test provenance, adaptive limits, model manifests, and historical metrics even though their runtime behavior belongs to later milestones;
- stop after Milestone 1 and report tests, decisions, and remaining risks.
```

## 27. References

- OpenCode agents: https://opencode.ai/docs/agents/
- OpenCode SDK: https://opencode.ai/docs/sdk/
- OpenCode server/API: https://opencode.ai/docs/server/
- OpenCode plugins and compaction hooks: https://opencode.ai/docs/plugins/
- OpenCode configuration and compaction: https://opencode.ai/docs/config/
- OpenCode permissions: https://opencode.ai/docs/permissions/
- llama.cpp server/router: https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md
- llama.cpp presets: https://github.com/ggml-org/llama.cpp/blob/master/docs/preset.md
