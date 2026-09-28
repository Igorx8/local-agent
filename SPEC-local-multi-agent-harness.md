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
| Repository reviewer | `qwen36-main` | Repository navigation, integration, regression, scope, and maintainability review | Read-only and approved diagnostic commands |
| Requirements reviewer | `qwen36-main` | Independently compare implementation with requirements and acceptance criteria | Read-only, fresh session |
| Finding validator | `qwen36-main` | Confirm/reject reviewer findings against evidence | Read-only |
| Repair agent | `qwen3-coder-impl` | Fix confirmed findings only | Read, edit, approved quality commands |
| Adversarial verifier | `qwen36-main` | Generate evidence-driven edge cases and challenge tests | Read-only source; isolated test artifacts |
| Final auditor | `qwen36-main` | Compare final state against requirements | Read-only |

Roles must be configurable. No role name may be hard-coded into the state machine.

### 4.1 Installed model registry

The implementation targets the two GGUF artifacts selected and tested on this workstation. These identifiers are normative; Codex must not infer, shorten, or silently substitute a different repository, quantization, or alias.

| Stable alias | Exact Hugging Face reference | Approx. artifact size | Reasoning | Intended use |
|---|---|---:|---|---|
| `qwen36-main` | `unsloth/Qwen3.6-35B-A3B-GGUF:UD-IQ3_S` | 13.7 GB | `auto`, budget 8192 | Supervisor, planning, test architecture, repository and requirements review, finding validation, adversarial verification, final audit |
| `qwen3-coder-impl` | `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL` | 17.7 GB | `off` | Initial implementation and focused repairs |

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
    roles: [supervisor, planner, testArchitect, repositoryReviewer, requirementsReviewer, validator, adversarialVerifier, auditor]

  qwen3-coder-impl:
    hfRef: unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL
    quantization: UD-Q4_K_XL
    approximateArtifactGiB: 17.7
    contextSize: 65536
    parallel: 1
    reasoning: off
    roles: [implementer, repair]

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
  loadMode: none
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

Replace only the JSON `model` value with `qwen3-coder-impl` when that model is active. A request naming an inactive alias must cause the lifecycle manager to switch models first; it must not fall back to another model.

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
  --ctx-size 65536 --parallel 1 --jinja --load-mode none \
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
  --ctx-size 65536 --parallel 1 --jinja --load-mode none --reasoning off \
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
load-mode = none
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

The generated local OpenCode configuration must map both stable aliases to the same local OpenAI-compatible endpoint:

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
        "qwen3-coder-impl": {"name": "Qwen3 Coder 30B A3B UD-Q4_K_XL"}
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

Agent definitions then select exactly `llama.cpp/qwen36-main` or `llama.cpp/qwen3-coder-impl` according to the role table. The configuration generator must merge these fields with project configuration without deleting unrelated user settings.

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

### 12.0 Project-language discovery and safe defaults

The harness core and packaged fallback configuration must be language agnostic. `harness init` deterministically derives a project profile from repository-owned marker files; no model may choose, rewrite, or interpolate a quality command. The first supported profiles are Node (`package.json` plus its lockfile), Python (`pyproject.toml`), Rust (`Cargo.toml`), Go (`go.mod`), and `none` for documentation-only or unrecognized projects.

- the packaged fallback config contains no ecosystem-specific gate or regression command;
- Node config includes only scripts that actually exist and selects npm, pnpm, Yarn, or Bun from the lockfile;
- Python, Rust, and Go profiles use executable-plus-argv commands with no shell parsing;
- an unrecognized/docs-only repository receives explicit null gates and cannot report test coverage that did not run;
- multiple root ecosystem markers fail closed as ambiguous unless the operator selects `--profile`; monorepo package discovery and multiple named gate groups remain a separately scoped enhancement;
- generated model registry and router paths remain valid when the config is created in another repository;
- `doctor` remains the authority for whether configured executables are installed; a detected profile is not evidence that a gate passed.

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
  modelStrategy: process
  modelStartupTimeoutMs: 600000
  modelShutdownTimeoutMs: 60000
  modelRestartCooldownMs: 2000
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
  repositoryReviewer: llama.cpp/qwen36-main
  requirementsReviewer: llama.cpp/qwen36-main
  validator: llama.cpp/qwen36-main
  repair: llama.cpp/qwen3-coder-impl
  adversarialVerifier: llama.cpp/qwen36-main
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
harness model start <qwen36-main|qwen3-coder-impl>
harness model switch <qwen36-main|qwen3-coder-impl>
harness model smoke <qwen36-main|qwen3-coder-impl>
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

- AC-043: The model registry contains the exact two Hugging Face references, quantizations, stable aliases, context settings, reasoning modes, and role mappings defined in Section 4.1.
- AC-044: OpenCode, llama.cpp requests, persisted state, telemetry, and handoffs use the same stable alias for a model.
- AC-045: `doctor` resolves and fingerprints every installed GGUF artifact and refuses silent model or quantization substitution.
- AC-046: Explicit-process mode starts each model with the effective launch profile defined in Section 4.3 and verifies the alias through `/v1/models` plus a smoke completion.
- AC-047: Router mode exposes the two stable aliases, keeps at most one large model loaded, and demonstrably switches between both aliases; otherwise the harness falls back safely to explicit-process mode.
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

### Operational resilience validation

- AC-062: A live conversation completes at least three cumulative prompts, and every turn starts from the exact successful checkpoint commit of the preceding turn while retaining bounded memory.
- AC-063: A live seeded defect exercises reviewer discovery, finding validation, repair-model switching, fail-before/pass-after regression proof, repeated gates, and final success.
- AC-064: A live run crosses at least two forced context handoffs, validates each bootstrap against Git and semantic state, and completes without duplicate mutation.
- AC-065: A first `Ctrl+C` produces a cooperative pause, persists a recoverable state, unloads the active model, and `harness resume` completes from the last consistent checkpoint.
- AC-066: After a host reboot, Fish and an IDE terminal can start the harness from an arbitrary Git workspace without repository-specific manual environment setup.
- AC-067: A forced client interruption explicitly cancels the accepted OpenCode server-side session and unloads its model; no residual session may resume inference or reload a model later.
- AC-068: A bounded endurance run of at least five consecutive prompts finishes without simultaneous model processes, residual GPU allocation, swap growth attributable to leaked model mappings, or unbounded agent steps.

### Explicit file references and IDE ergonomics

- AC-069: `harness run`, `harness continue`, and `harness chat` recognize one or more `@relative/path` references and attach the exact referenced text to the current prompt with unambiguous path/content boundaries.
- AC-070: File references resolve relative to the selected Git workspace, canonicalize symlinks, and fail closed when a target escapes the workspace, does not exist, is not a regular readable file, or matches configured denied/sensitive paths.
- AC-071: Referenced files have deterministic per-file and aggregate byte/token limits; binary files and oversized input are rejected with actionable errors instead of being truncated silently.
- AC-072: Every resolved reference records path, size, and SHA-256 in run artifacts, while conversation memory retains bounded provenance and does not duplicate unchanged file contents indefinitely.
- AC-073: Reference parsing supports multiple files, quoted paths containing spaces, and an explicit way to escape a literal `@`; it never expands model-authored text, invokes a shell, or treats referenced contents as executable commands.
- AC-074: Missing or rejected references stop before model inference and list every invalid target without leaking contents from allowed or denied files.
- AC-075: IDE documentation and completion-friendly syntax cover current-workspace use, multiple references, spaces, escaping, limits, and security behavior.
- AC-076: `harness run`, `continue`, and `resume` print the `runId` and isolated worktree path immediately, then emit concise stage, role/model, checkpoint, gate, retry, handoff, pause, and terminal-status progress without requiring a second terminal.
- AC-077: A `--follow`/progress mode refreshes human-readable status without exposing prompts, secrets, or unbounded model logs; structured JSON/JSONL output remains available for IDE integrations and scripts.

### Language-agnostic project gates

- AC-078: The packaged fallback config has no Node, Python, Rust, Go, or other ecosystem-specific quality or regression command.
- AC-079: `harness init` deterministically detects Node, Python, Rust, Go, or a no-gates profile from repository-owned markers, and reports the selected profile and configured gates.
- AC-080: Node initialization configures only declared package scripts and derives the package manager from a repository lockfile; Python, Rust, and Go commands remain executable-plus-argv values without shell interpolation.
- AC-081: Documentation-only and unknown projects receive explicit null gates; skipped capability is never represented as a passing test.
- AC-082: Multiple root ecosystem markers fail closed until an operator selects an explicit profile, and `doctor` validates the resulting executable availability.
- AC-083: A configuration generated in another repository retains valid absolute paths to the local model registry and router preset.

### Interactive local-agent shell

- AC-084: Invoking `local-agent` with no subcommand from any directory inside a Git workspace opens an interactive prompt bound to that workspace, without requiring the operator to remember harness subcommands.
- AC-085: The interactive entry point reuses a healthy configured OpenCode service or starts one through the installed SDK, records ownership, waits for readiness, and closes only an owned service on every shell exit path.
- AC-086: Plain input creates or continues the selected bounded workspace conversation, supports `@file` references, and displays the same safe live run progress as non-interactive execution.
- AC-087: `/help` lists every supported slash command with concise usage, and unknown commands fail locally without starting model inference or a workflow run.
- AC-088: `/status`, `/memory`, `/files`, `/worktree`, `/model`, `/doctor`, and `/report` expose bounded read-only information without leaking prompts, referenced contents, credentials, or unbounded model logs.
- AC-089: `/new`, `/resume`, `/pause`, and `/handoff` map to the existing safe conversation/recovery operations and preserve their fail-closed state and Git guarantees.
- AC-090: `/clear` affects only terminal presentation, while `/exit` cooperatively refuses to abandon an active run and performs owned-service/model cleanup before returning control to the shell.
- AC-091: The prompt provides persistent local command history and completion for slash commands; Fish and IDE documentation cover zero-argument startup, service ownership, recovery, file references, and all commands.

### Fast questions and explicit workflow routing

- AC-092: `/ask` performs one read-only local-model request and returns its text without creating a workflow run, worktree, branch, checkpoint, gate, reviewer, repair, or audit.
- AC-093: `/ask` supports the same validated `@file` references as workflow prompts and persists only bounded question/answer and file provenance.
- AC-094: `/run` always executes the complete audited engineering workflow, including isolated worktree, planning, implementation, deterministic gates, independent reviews, repair loop, and final audit.
- AC-095: Plain questions route deterministically to read-only ask mode; ambiguous action requests never gain mutation permission from probabilistic model classification and can be forced explicitly with `/ask` or `/run`.
- AC-096: `/ask --web` accepts only explicit HTTP(S) URLs, blocks loopback/private/link-local destinations after DNS resolution and on every redirect, and applies timeout, redirect, content-type, and byte limits.
- AC-097: Remote content is delimited as untrusted data, never executed, and records URL, byte size, content type, and SHA-256 without cookies, ambient authorization, or response-body leakage in errors.
- AC-098: Ask-mode interruption cancels its OpenCode session, unloads the model, and leaves no mutating run or residual model process.

### Focused fixes

- AC-099: `/fix <task>` creates an isolated auditable worktree and may mutate code, but does not execute the full planning, oracle-design, dual-review, advanced-verification, or final-audit pipeline.
- AC-100: A focused fix captures baseline gates before editing, uses only the configured implementer model for the edit, creates a checkpoint, and runs every configured required gate afterward.
- AC-101: A fresh read-only reviewer inspects the focused diff and gate evidence; actionable findings prevent success and receive at most one bounded repair plus repeated gates and review.
- AC-102: A failed baseline, implementation, checkpoint, required gate, review, repair, interruption, or cleanup leaves persisted state and artifacts and cannot be reported as success.
- AC-103: `/fix` retains command policy, path scope, secrets redaction, strict single-model residency, final unload, protected-branch, and no-automatic-merge guarantees.
- AC-104: Plain requests never select focused mutation from probabilistic inference; `/fix` is explicit, while `/ask` remains read-only and `/run` remains the complete workflow.

### Current-worktree publication

- AC-105: `/fix` materializes its first implementation checkpoint immediately as uncommitted changes in the repository working tree from which `local-agent` was started, and synchronizes a later repair checkpoint; `/run` materializes its reviewed checkpoint after success.
- AC-106: Publication never merges, commits, resets, or changes the current branch; the isolated branch and checkpoint remain the auditable source of the patch.
- AC-107: Publication fails closed before modifying the repository if its HEAD or working tree changed after preflight, preserving both user work and the isolated checkpoint.
- AC-108: `/apply [run-id]` explicitly materializes the latest preserved checkpoint from a terminal failed, escalated, or successful run as uncommitted changes, records that failed-run approval was manually bypassed, and never reruns a model, merges, commits, or moves the current branch.
- AC-109: A subsequent `/fix` accepts a dirty working tree only when every dirty path and blob exactly matches a persisted harness checkpoint, starts its isolated worktree from that checkpoint, and synchronizes the new checkpoint back to the same root; unrelated or manually modified content remains blocked.

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
9. Full local run using the two configured GGUF models.
10. Sequential smoke run proving `qwen36-main -> qwen3-coder-impl -> qwen36-main`, with only one loaded model and the expected alias recorded for every response.

## 24. Implementation milestones

### Milestone 0: discovery spike

- Inspect installed OpenCode and llama.cpp versions.
- Verify the installed server entry points (`llama serve` and, if present, `llama-server`) and compare every required launch flag with local `--help` output.
- Confirm actual SDK message token fields and SSE event shapes.
- Confirm router model switching and unloading on this machine.
- Resolve the two exact Hugging Face references in Section 4.1 to their cached GGUF path or shards and calculate reproducible fingerprints without duplicating model data.
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

### Milestone 11: operational resilience and IDE validation

- add an automated live-validation driver that records timestamps, model/session IDs, process counts, VRAM, RAM, and swap without embedding credentials;
- validate a three-turn persistent conversation and exact checkpoint ancestry for AC-062;
- seed a deterministic repairable defect and retain reviewer, triage, regression-proof, gate, and final-audit evidence for AC-063;
- force at least two context handoffs with a test-only threshold override and verify continuity for AC-064;
- validate cooperative pause/resume and model cleanup for AC-065;
- validate cold startup through Fish and the documented IDE command after a real reboot for AC-066;
- make forced interruption cancel the active OpenCode session before or alongside model unload, then prove no residual inference for AC-067;
- run five bounded sequential prompts while sampling process and memory state for AC-068;
- classify each scenario as passed, failed, or blocked; never infer runtime success from unit tests;
- publish a reproducible operational-validation report and stop after Milestone 11 for review.

Current operational result (2026-09-05): deterministic coverage and a complete clean two-Qwen run pass. Two cumulative conversation turns pass with exact checkpoint ancestry; the third turn fails closed after required gates fail and validator output omits a merged finding. AC-062 and AC-068 therefore remain failed pending semantic-contract retry hardening and a repeated five-turn run. AC-063 and AC-064 still require their complete live scenarios. AC-065 and AC-067 have partial live interruption/cleanup evidence but not the complete acceptance sequence in one passing report. AC-066 remains blocked on a real reboot and IDE-terminal receipt. Milestone 11 is not complete until these runtime results are passed or explicitly accepted as blocked.

Incremental update (2026-09-06): semantic triage retry hardening is implemented. AC-062 now passes with three successful exact-ancestry turns in `conv-20260906164855-02235e24`. Its monitored fourth turn failed closed after an incomplete repair left tests failing, so AC-068 remains open. The run retained one-model and zero-swap-growth evidence; it was not counted as an endurance pass.

Incremental update (2026-09-07): AC-066 passes with distinct persisted pre/post reboot boot IDs and successful Fish/IDE-terminal startup. AC-064 remains runtime-blocked after three fail-closed live attempts; deterministic handoff coverage passes, but malformed local-model abstraction/bootstrap responses prevented a successful two-handoff run. Bounded bootstrap retries, rejected-session aborts, wrapper-tolerant JSON extraction, mutation-tool denial, and exact abstraction/bootstrap shapes are now implemented. AC-063, AC-064, AC-065, and AC-068 remain open; AC-062, AC-066, and AC-067 pass.

Close Milestone 11 through independently resumable validation slices. Each slice must write its report and assertion result before the next begins: `11A` AC-063 repair proof; `11B` AC-064 two-handoff continuity; `11C` AC-065 pause/resume; and `11D` AC-068 five-turn endurance. A stopped Codex session must be able to continue from the first incomplete slice by reading persisted artifacts. Do not combine all remaining scenarios into one foreground command or defer every verdict until the end.

Before resuming live validation, slice `11E` closes the language-assumption defect exposed by a documentation-only repository: remove ecosystem commands from the packaged fallback, add deterministic `harness init --profile auto|none|node|python|rust|go`, fail closed on ambiguous roots, keep generated local-model paths portable across repositories, and pass fixture tests for AC-078–AC-083. This slice changes configuration only; it does not turn a skipped gate into proof of correctness and does not complete any pending live criterion.

Incremental update (2026-09-09): slice `11E` passes AC-078–AC-083 with TypeScript validation, 102 unit/integration tests, a production build, and initialization of the documentation-only `distributed-ticketing-lab` fixture as profile `none`. Its generated config contains zero repository commands and valid absolute local-model paths. Runtime health remains separate from this deterministic verdict and must still be checked in the operator's unsandboxed terminal.

Slice `11A` attempt `20260909140103-da32d99c` reached a proven repair and repeated passing gates but failed closed before audit because two distinct merged findings shared `F-001`, making exact triage coverage impossible. The harness must deterministically namespace colliding non-duplicate reviewer IDs; semantic duplicates retain their existing attribution. The failed operational report remains evidence, and AC-063 requires a fresh passing rerun after this regression fix.

The first post-fix retry `20260909141449-4b6db66c` completed successfully and respected single-model/swap limits, but its `repair` assertion failed because the initial implementation contained no defect and no repair was needed. AC-063 therefore remains pending. Its next retry must use a deterministic seeded production defect with a passing but incomplete baseline test, so reviewer discovery and fail-before/pass-after repair evidence do not depend on stochastic model output.

Slice `11A` passes on seeded run `20260909142408-98ce1d9c`: reviewer discovery and validation triggered one `qwen3-coder-impl` repair, three fail-before/pass-after proofs were retained, repeated test/typecheck gates passed, final audit succeeded, maximum model-process count was one, swap growth was zero, and final model state was stopped. The independent `repair` assertion passes. AC-063 is complete; AC-064/11B is the next unresolved slice and was not started as part of this verdict.

Slice `11B` has a persisted runtime-blocked verdict from run `20260909143944-efa72610`. The first handoff completed; the second handoff artifact was generated but its bounded bootstrap attempts failed exact pending-acceptance-criteria verification, so it was not counted, mutation was blocked, and cleanup stopped the sole model with zero swap growth. This is the fourth fail-closed live attempt in the cumulative record. AC-064 remains blocked until the local model reproduces the supplied pending IDs exactly or deterministic identity verification is explicitly separated from semantic model verification without weakening bootstrap guarantees. No further 11B loop is permitted in this milestone; 11C is next.

Operator decision: resolve AC-064 before 11C. The selected design separates deterministic bootstrap state from probabilistic semantic verification: Git identity, objective, acceptance IDs, file constraints, prohibited actions, and exact next action come from validated harness state and are not model-authored or model-restated; the fresh model session must strictly confirm objective/next-action understanding and report zero contradictions. Omitted, invented, altered, and reordered deterministic values remain covered by code-level validation. The one-attempt loop restriction resets only after this implementation and deterministic regression suite pass; then exactly one fresh 11B live rerun is allowed.

Post-fix run `20260909145958-501d7c36` passes AC-064 with three validated handoffs and fresh session restarts, zero inference retries, one unique implementation checkpoint, successful terminal status, maximum one model process, negligible swap growth, and final model cleanup. The strengthened assertion verifies contiguous handoff sequences, unique sessions, retained artifacts, matching restart evidence, and no duplicate kind/iteration mutation checkpoint. Slice 11B is complete; AC-065/11C is next.

Slice `11C` uses a dedicated argv-only operational adapter that observes the newly created run, sends exactly one `SIGINT` during active inference, requires an immediate passing paused/stopped assertion before resume, resumes the same run ID, and then requires the final pause/resume assertion. Both assertions and the outer resource-sampling report must be persisted before AC-065 receives a verdict.

Run `20260909173813-aee30f92` passed the immediate pause/cleanup assertion, then failed after restart because a schema-valid oracle referenced an acceptance description rather than its ID and semantic validation occurred outside the retry loop. The failed report is retained. Oracle and plan reference validation now execute within bounded fresh-session retries, with regression coverage for invalid-then-valid semantic outputs; challenge and audit reference validation follow the same policy on the normal path. AC-065 remains pending until a fresh 11C run succeeds.

Post-fix run `20260909181224-5d83d6d1` passes the paused-state and final pause/resume assertions on the same run ID and ends `SUCCEEDED` with the model stopped. Its outer scenario failed only because the driver attributed 1,237.5 MiB of host-wide `/proc/meminfo` swap growth to the model. The operational schema now retains global swap as diagnostic evidence and separately measures aggregate `VmSwap` for live `llama-server` PIDs; the configured swap limit applies to this attributable model delta. AC-065 remains pending for one rerun with the corrected resource metric.

Final run `20260909182058-c72b24cf` passes AC-065 and completes slice 11C. The monitored adapter sent one interrupt during active inference, persisted and independently asserted `PAUSED` plus stopped model state, resumed the exact run ID, and independently asserted terminal `SUCCEEDED` plus stopped model state. The outer report passed in 171,588 ms with exit code 0, maximum one model process, no timeout, no inference retries, approximately zero host-swap delta, and no attributable model-swap growth. Slice 11D/AC-068 is the next unresolved validation and was not started as part of this verdict.

Slice 11D uses a resumable one-turn adapter. Each invocation requires the expected turn number, creates or continues one exact conversation, atomically persists progress and its run IDs, and writes an incremental ancestry/cleanup assertion. Each turn has its own outer resource report. A missing, failed, duplicated, or out-of-order turn fails closed and no later turn may begin; only the fifth passing assertion supplies the AC-068 verdict.

The first 11D turn, run `20260909201114-7696126e`, failed closed at final audit because all bounded auditor attempts returned a narrative verdict instead of JSON. No endurance progress was committed and turn 2 was not allowed to start. The run retained one-model, zero attributable model-swap growth, and final cleanup evidence. The audit prompt now requires critical problems to be represented inside the typed `findings` and `decision` fields and forbids narrative output outside the JSON object; a new conversation must restart turn 1 after deterministic tests pass.

The restarted 11D conversation passed three exact-ancestry turns with zero inference retries; its fourth run `20260909202826-6ad616de` failed closed. Local OpenCode session evidence identifies `CRITICAL - MAXIMUM STEPS REACHED` as a platform-injected terminal message after the auditor wasted its bounded steps attempting unavailable Git-history discovery. Final audit now receives deterministic changed-file, gate, and independent-review evidence in the prompt, must not rediscover Git history, and may use at most two optional tool calls before returning JSON. The step limit is not raised. AC-068 remains pending and requires a fresh five-success conversation after deterministic tests pass.

The next fresh sequence passed two turns, then the host hard-froze in run `20260909204159-7f22de6b` exactly as execution moved from `qwen36-main` planning to `qwen3-coder-impl` implementation, before a response or checkpoint. The prior-boot kernel journal records list corruption and RCU exit warnings at that timestamp, without OOM-killer or NVIDIA Xid evidence. No completed turn-3 report exists; progress remains durably at two. Given earlier bad-page-map evidence during GGUF unmapping on this host, router switching is no longer a safe default. Explicit process isolation now requires process-group exit, endpoint disappearance, VRAM release, and a configurable post-release cooldown before launching another alias. Router mode is explicit opt-in. AC-068 remains pending until deterministic lifecycle tests and a fresh five-turn process-isolated run pass.

The first process-isolated 11D attempt failed before model residency because the rebooted host had no OpenCode service on port 4096. A controlled single-model explicit-process smoke passed both completion and required tool calling, while the OpenCode health probe failed independently. New-run preflight now verifies the loopback OpenCode endpoint before any model action and returns an actionable startup command rather than spending inference retries on generic `fetch failed`. The failed report is retained as missing-prerequisite evidence and does not count toward AC-068.

With OpenCode restored, process-isolated run `20260910014055-e47036df` completed successfully and cleaned up with zero attributable model-swap growth, but its outer report observed zero model processes because explicit `llama serve` is named `llama` and telemetry only matched `llama-server`. The `/proc` sampler now recognizes exactly both server entry-point names for process count and aggregate `VmSwap`, excluding `llama-cli`. This run remains diagnostic rather than AC-068 proof; the final five-turn sequence must restart with corrected telemetry.

Final process-isolated conversation `conv-20260910015956-817eceb6` passes AC-068. Five consecutive distinct runs succeeded with exact checkpoint ancestry `79005501 -> 4d390f3c -> b482be70 -> 5eb9a312 -> 9f7dd150 -> 6ec99b92`. Every independently persisted outer report passed with maximum one model process, zero attributable model-swap growth, bounded inference retries (0, 0, 1, 1, 0), no timeout, and final model cleanup. The fifth endurance assertion passes with no failures. Reports, assertions, and progress are retained as `11D-process-v3-*`.

Milestone 11 is complete: AC-062, AC-063, AC-064, AC-065, AC-066, AC-067, and AC-068 all have persisted runtime verdicts; deterministic tests and production build pass. Stop after this milestone for review before beginning Milestone 12.

The default local regression adapter is `harness regression-proof <command> [args...]`. It must materialize the exact defective and repaired checkpoints, overlay repair-changed tests onto the defective snapshot for production repairs, preserve the original defective test for test-only repairs, execute only the configured command argv, require non-zero before and zero after, and reject model-authored reproduction text as executable input.

Performance findings captured during Milestone 11 must feed a later optimization milestone. In particular, reports must distinguish model load/unload time, inference time, tool-step count, structured-output retries, deterministic gates, and verification time. Any future risk-proportional policy must retain deterministic gates and independent review while calibrating per-role step budgets; it must not claim improvement from merely skipping evidence-producing stages.

### Milestone 12: explicit file references and IDE ergonomics

- parse explicit `@relative/path` references before inference for CLI and interactive prompts;
- resolve and canonicalize references strictly inside the selected Git workspace;
- enforce denied-path, sensitive-file, regular-file, binary, per-file, aggregate, and token-budget checks;
- inject referenced text with deterministic boundaries and provenance rather than allowing implicit shell expansion;
- persist path, byte size, SHA-256, and bounded conversation-memory provenance;
- support multiple references, quoted paths with spaces, and escaped literal `@` syntax;
- emit immediate run identity and bounded live progress for long-running commands, with an explicit structured mode for IDE consumers;
- add unit, integration, security, conversation-memory, progress-output, and CLI tests for AC-069–AC-077;
- document Fish and IDE usage and stop after Milestone 12 for review.

Implementation result (2026-09-10): AC-069–AC-077 pass deterministically. `run`, `continue`, and `chat` resolve explicit workspace-relative references before a conversation turn or inference begins; canonical path, denied/sensitive path, regular/readable file, binary, per-file, aggregate-byte, and estimated-token checks fail closed and report all rejected targets without their contents. Multiple and quoted paths plus `@@` literal escaping are covered. Each run persists bounded path/size/SHA-256/token provenance and conversation memory retains provenance without referenced contents. `run`, `continue`, and `resume` now emit immediate run/worktree identity and a bounded allowlisted progress stream, with human, off, and JSONL modes. Unit, integration, security, memory, progress, full-suite, build, Fish/IDE documentation, and CLI-help validation pass. Milestone 12 is complete and stops here for review.

### Milestone 13: interactive local-agent shell

- add a `local-agent` executable that opens the current Git workspace directly;
- reuse a healthy OpenCode endpoint or start it through the installed SDK, tracking ownership and readiness before accepting prompts;
- run plain text as cumulative conversation turns with `@file` support and bounded live progress;
- implement `/help`, `/status`, `/memory`, `/files`, `/worktree`, `/model`, `/doctor`, `/report`, `/new`, `/resume`, `/pause`, `/handoff`, `/clear`, and `/exit` on top of existing safe operations;
- reject unknown or malformed slash commands before inference and never execute slash arguments through a shell;
- provide bounded persisted command history and completion for slash commands;
- add unit, integration, lifecycle, security, and CLI-entry tests for AC-084–AC-091;
- document Fish and IDE usage and stop after Milestone 13 for review.

Milestone 13 must retain all prior single-model residency, conversation, path-security, interruption, and no-automatic-merge guarantees. Starting the convenience shell does not authorize background daemons that outlive an owned interactive session.

Implementation result (2026-09-10): AC-084–AC-091 pass deterministically. The packaged `local-agent` executable selects the current Git workspace and opens the interactive shell with no subcommand. It reuses a healthy OpenCode endpoint or starts an owned SDK server with the explicit local OpenCode configuration, verifies readiness, and closes only owned service state. Plain prompts reuse the bounded conversation workflow, `@file` handling, isolated worktrees, live progress, cooperative interruption, and final model cleanup. Every documented slash command is parsed locally as argv data; unknown/malformed commands cannot start inference. Read-only views omit prompt and referenced-file contents. Private bounded history and slash completion are implemented. TypeScript, full tests, production build, Fish CLI entry/help, and installation validation pass. Milestone 13 is complete and stops here for review.

Post-completion correction (2026-09-10): an initialized but commitless Git repository previously failed at `git rev-parse HEAD`. Before any inference, the harness now creates a deterministic empty baseline commit when the unborn repository has no uncommitted files. When files exist, the interactive shell lists bounded path evidence and requires an explicit `y`/`yes` before staging all current files into the initial commit; refusal makes no Git change. Non-interactive commands remain fail-closed and require an explicit initial commit.

### Milestone 14: fast ask and explicit workflow routing

- add `/ask` as one read-only `qwen36-main` request without workflow/run creation;
- preserve bounded ask context and secure `@file` provenance without duplicating file contents;
- add `/run` as the explicit complete engineering workflow entry;
- route obvious plain questions deterministically to ask and keep ambiguous action text on the conservative run path;
- add explicit `/ask --web` retrieval with SSRF, redirect, timeout, type, and byte controls;
- cancel the OpenCode ask session and unload its model on interruption;
- add routing, parser, web-security, build, and regression tests for AC-092–AC-098;
- document behavior and stop after Milestone 14 for review.

Implementation result (2026-09-10): AC-092–AC-098 are implemented. Ask mode uses one read-only supervisor session, bounded persisted context, the existing secure file-reference resolver, artifact provenance, cancellation, and final model cleanup. Explicit web mode accepts exactly one HTTP(S) URL, validates DNS and every redirect against local/private/link-local targets, rejects credentials and non-text content, and applies bounded retrieval. `/run` retains the unchanged full audited workflow. Deterministic parser/routing and web-security tests pass alongside the complete regression suite and production build.

### Milestone 15: focused fixes

- add explicit `/fix` without changing conservative automatic routing;
- create a dedicated isolated run/worktree with persisted baseline and artifacts;
- require healthy baseline and post-edit configured gates;
- perform one fresh focused review and at most one repair followed by repeated gates/review;
- fail closed and clean the model on every error or interruption;
- retain scope, command, Git, redaction, and single-model policies;
- test parser, lifecycle, gates/review state, build, and regressions for AC-099–AC-104;
- document the ask/fix/run decision and stop after Milestone 15 for review.

Implementation result (2026-09-10): AC-099–AC-104 are implemented. `/fix` has a dedicated persisted run and isolated worktree, requires passing baseline and post-edit gates, uses the configured implementer for the initial edit, validates paths before checkpoint creation, runs one fresh focused reviewer, permits at most one repair, and repeats gates/review before success. Errors persist a failed state and final cleanup unloads the model. Parser, scope-policy, regression-suite, TypeScript, and production-build validation pass; a live model fix was intentionally not combined with implementation validation and remains the recommended first hands-on check.

### Milestone 16: current-worktree publication

- preserve isolated implementation, gates, review, checkpoint, and recovery evidence;
- publish the first `/fix` implementation checkpoint immediately, retain it even if later review fails, and synchronize an approved repair incrementally;
- after `/run` succeeds, generate a patch from the exact preflight commit to the approved checkpoint;
- validate the patch and recheck the repository HEAD and cleanliness before applying it;
- materialize the patch as uncommitted changes in the current working tree, without merge, commit, reset, or branch movement;
- persist the exact publication patch and metadata with the run artifacts;
- reject concurrent user changes without overwriting them;
- allow explicit recovery of a preserved terminal-run checkpoint through `/apply [run-id]` without another inference;
- test successful publication, HEAD preservation, concurrent-change refusal, and failed-run recovery for AC-105–AC-108.
- test recognition and continuation of an exact previously published checkpoint for AC-109.

Post-hands-on correction (2026-09-14): the first live `/fix` reached `IMPLEMENTING` but a transient OpenCode request ended as the opaque error `fetch failed`. Focused inference now uses the same bounded `workflow.inferenceRetries` policy as the complete workflow, persists `inference.retry` evidence, verifies OpenCode health before each retry, and identifies whether failure occurred during model activation, session creation, prompt submission, or response retrieval. An unavailable OpenCode service stops retries immediately; model cleanup and failed-state guarantees remain unchanged.

Second hands-on correction (2026-09-15): a larger focused request demonstrated that OpenCode's synchronous prompt transport could drop its HTTP fetch after approximately five minutes even though the configured inference timeout was fifteen minutes and OpenCode remained healthy. Role inference now submits through the installed SDK's `promptAsync` endpoint, polls the typed session status until idle with the configured timeout, retrieves the completed response afterward, and explicitly aborts the server-side session on polling/transport failure before retrying. Focused runs now persist agent/model lifecycle events, while human and JSONL progress emit a content-free heartbeat every 30 seconds without exposing prompts or responses. Deterministic SDK-contract, polling, timeout, cancellation, progress, TypeScript, and build tests pass; a new long live-model run remains runtime validation rather than an assumed result.

Third hands-on correction (2026-09-15): the first asynchronous live `/fix` made no worktree change for ten minutes, after which a dead model process produced `kill ESRCH`; cleanup masked the primary failure, retry events were flushed after control returned, and the progress timer remained active. `/fix` now uses dedicated 8-step implement/repair and 4-step review agents, requires tool-first editing with a concise final response, limits focused inference to 180 seconds, does not retry a focused timeout, and allows at most one retry for other failures. The process manager rechecks health before reusing an alias and treats an already-exited PID as stopped. Reporter cleanup is unconditional, and unload cleanup no longer replaces an already-persisted workflow error. The complete workflow retains its separate 15-minute inference budget.

Fourth hands-on correction (2026-09-15): a subsequent run remained in `IMPLEMENTING` beyond the focused inference timeout with no active OpenCode session or worktree diff. The timeout had not started because model activation was still polling after its llama.cpp child had already exited. Process activation now observes child exit concurrently with health polling, retries the launch without waiting for the 10-minute startup deadline, and reports exit code/signal if both launches fail. Focused progress safely streams model loading, tool state transitions, changed paths, and per-step token totals from installed OpenCode SDK message parts; raw tool inputs, file contents, reasoning, prompts, and response text remain excluded.

Fifth hands-on correction (2026-09-15): runtime inspection found a residual `qwen36-main` process occupying 13,072 MiB while `/fix` attempted to start `qwen3-coder-impl`; port collision and unavailable VRAM caused both activation failures, while repository-scoped `harness model stop` could not see the process state created elsewhere. After terminating the exact confirmed PID, VRAM returned from 13,445 MiB to 356 MiB. An isolated coder validation then loaded in 56 seconds and passed completion plus required tool calling in 1.3 seconds, proving the model/runtime works independently of the workflow. Interactive startup now detects advertised registered aliases, finds only an exact local llama executable/port/alias match, automatically terminates it only when its parent is gone, and refuses ambiguous or actively owned processes. No arbitrary port occupant is killed.

Sixth hands-on correction (2026-09-15): a focused documentation run loaded the coder, completed several tool steps, and then remained on an atomic `write` tool call until the 180-second focused timeout. No partial file was exposed and the worktree remained unchanged, but `maxSteps` did not bound the number of tokens generated inside one model step. The OpenCode provider configuration now uses its documented per-model `limit.context` and `limit.output` fields (65,536/16,384 for the main model and 65,536/8,192 for the coder). The focused prompt also treats referenced-file contents strictly as data, forbids creating paths merely mentioned by that data, and bounds documentation indexes/summaries to 200 lines. This keeps tool calls atomic while placing a deterministic ceiling on an individual response; a repeated live `/fix` remains the runtime acceptance check.

Seventh hands-on correction (2026-09-15): the repeated `/fix` successfully created `tasks/README.md`, checkpointed it, switched models, found real duplicate task IDs, and completed a repair. That repair rewrote the entire existing document instead of editing the affected ranges and introduced three semantic duplicates, which the second review correctly rejected. Focused review is now explicitly limited to requirements stated by the task or defects demonstrably introduced by the change. The single allowed repair must read affected ranges, use a minimal edit for existing files, preserve unaffected content byte-for-byte, avoid unrelated changes and new paths, and verify the edited ranges. The fail-closed one-repair boundary remains unchanged.

Eighth hands-on correction (2026-09-15): a run started loading the 17.6 GB coder while the host was already paging and sustaining heavy disk I/O from another workload, after which the desktop became unresponsive and required a forced power-off. The prior boot retained no OOM or NVIDIA Xid, but its last sysstat sample showed 2.9 GiB swap in use, active swap-out, approximately 190 MiB/s aggregate I/O, and 122% committed memory. Every managed or manual model load now passes a fail-closed resource-admission gate after the previous model is released and before a new load is issued. Required available RAM is the exact registered artifact size plus a configurable 4,096 MiB reserve; default limits also reject more than 1,024 MiB swap in use, more than 2,048 MiB VRAM already allocated, any non-llama CUDA compute process, or unavailable required telemetry. The gate never terminates external workloads and reports every blocking measurement.

Ninth hands-on correction (2026-09-15): a healthy coder generated a 2,407-token atomic write in 105 seconds in one run, while the next attempt reached the same `write pending` state but was cancelled by the old 180-second wall-clock timeout despite continuing generation. Focused inference now separates a configurable 600-second absolute ceiling from a 100-second inactivity watchdog. The installed OpenCode SDK's typed pending tool part exposes incremental raw argument data; the harness observes changes only to refresh the watchdog and emits bounded byte-count progress at 1 KiB boundaries without exposing tool arguments, file content, prompts, reasoning, or response text. A session with no observable progress for 100 seconds is aborted, while a progressing write may continue up to the absolute ceiling.

Tenth hands-on correction (2026-09-15): the first admission-gated retry was blocked with 20,072 MiB available against a 20,943 MiB coder requirement and incorrectly scheduled an inference retry for the same deterministic condition. The incident condition remains independently covered by the 1,024 MiB swap ceiling, while the artifact-sized RAM rule now uses a calibrated 2,048 MiB host reserve, making the coder requirement approximately 18.9 GiB. Admission failures are explicitly non-retryable, and the interactive reporter flushes persisted lifecycle events before printing the terminal failure so output order reflects execution order.

Eleventh hands-on correction (2026-09-15): the next real run proved that OpenCode 1.18.25 leaves a pending `write` argument buffered without publishing incremental raw-part updates, so the 100-second inactivity watchdog could not distinguish slow generation from a stall. While the OpenCode signal remains supported, the watchdog now also polls the authenticated local llama.cpp `/metrics` endpoint and treats increases in `llamacpp:tokens_predicted_total` as progress. The installed llama binary contains the exact `tokens_predicted_total` Prometheus metric contract. Visible progress is bounded to 128-token counter buckets and never exposes generated content. Missing metrics remain non-fatal and fall back to OpenCode activity plus the existing inactivity and absolute ceilings; the next live run is retained as runtime verification of metric delivery during generation.

Twelfth hands-on correction (2026-09-15): the live run `fix-20260915200040-34462b19` proved that `llamacpp:tokens_predicted_total` is completion-aggregated in this runtime: it remained at zero while a pending `write` was being generated, causing another false inactivity verdict. The watchdog therefore uses llama.cpp's live `/slots` state and sums `next_token.n_decoded` only for slots whose `is_processing` value is true. Counter growth renews the inactivity deadline; a counter reset is treated as a new generation step. The older `/metrics` fallback is superseded. Failure or absence of `/slots` remains non-fatal and falls back to OpenCode activity plus the absolute request ceiling. Deterministic parser and watchdog tests are required; the next real `/fix` remains the runtime acceptance check.

Thirteenth hands-on correction (2026-09-15): a live focused run completed implementation and reached repository review, but the reviewer returned prose beginning with `CRITICAL -` instead of its required JSON contract. Every role invocation now permits exactly one schema-correction turn in the same OpenCode session after JSON parsing or schema validation fails. The correction disables mutating tools, includes only the exact response schema, and does not repeat implementation or discard its checkpoint. A second invalid response still fails closed and remains eligible for the existing bounded inference retry policy.

Fourteenth hands-on correction (2026-09-16): run `fix-20260916171655-e6100d00` correctly failed closed after its only repair removed three duplicate task identifiers but introduced or retained seven other collisions (`TASK-140` through `TASK-144`, `TASK-170`, and `TASK-171`). Focused implementation must validate file-wide integrity when it introduces identifiers, numbering, links, or references. Focused review must enumerate the complete affected-file collision scope, and repair must inspect the full identifier namespace rather than apply suggested ranges blindly. Surgical editing remains mandatory, but verification expands to every file-wide invariant implicated by the finding.

Fifteenth hands-on correction (2026-09-18): run `fix-20260918181332-7912e5fc` exposed that focused review findings were sent directly to repair without independent validation. The reviewer invented continuous numbering requirements despite the task and review prompt not requiring them, and the repair exhausted its step budget without editing while the workflow surfaced only `checkpoint has no changes`. Focused review findings now receive an independent validator classification before repair; only confirmed critical/high findings can consume the single repair. Invalid, stylistic, out-of-scope, and low/medium findings do not block publication. Human-decision classifications still fail closed. A repair with no worktree diff stops before checkpoint creation and reports its persisted blockers explicitly.

Sixteenth hands-on correction (2026-09-18): model admission incorrectly classified the GNOME `ptyxis` terminal process as a foreign CUDA workload. Exact known desktop/display clients (`ptyxis`, `gnome-shell`, `Xwayland`, and `Xorg`) are now excluded from the foreign-compute-process rule; their aggregate VRAM remains covered by the existing fail-closed VRAM ceiling. Python, ComfyUI, Blender, unknown workers, and every other non-llama compute process remain blocking.

Seventeenth hands-on correction (2026-09-28): run `fix-20260928225140-edfa3174` inherited the previously published `tasks/README.md`; the implementer rewrote byte-identical content, leaving the isolated worktree clean, and checkpoint creation incorrectly failed with `checkpoint has no changes`. When an exact published checkpoint was adopted as the run base and implementation produces no additional diff, `/fix` now reuses that checkpoint, records `checkpoint.reused`, and continues gates/review instead of requiring a meaningless new commit. A no-op implementation without an inherited checkpoint remains an explicit failure.

Eighteenth hands-on correction (2026-09-28): repeated hands-on evidence showed that isolated-worktree publication made `/fix` behave unlike an interactive coding agent and repeatedly hid usable output. `/fix` now reads and edits the repository working tree directly, including its existing uncommitted state. Audit checkpoints are created through a temporary Git index and detached commit objects; they do not stage user files, move `HEAD`, change the current branch, merge, or commit into that branch. Existing dirty content is captured as the baseline snapshot, so checkpoint diffs contain only changes made during the focused turn. Gates and reviewers inspect the same files visible to the IDE, and both successful and failed reviews leave implementation changes in place. The complete `/run` retains isolation and automatic final publication.

Milestone 12 begins only after Milestone 11 has a persisted verdict for every AC-062–AC-068 scenario. A runtime-blocked Milestone 11 criterion may remain blocked only when its report states the exact prerequisite or repeated failure evidence; it must not be silently treated as passed.

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
