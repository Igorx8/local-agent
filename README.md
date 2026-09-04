# Local Multi-Agent Engineering Harness

Local-only engineering orchestrator using OpenCode and llama.cpp. Milestones 0–10 are implemented, including persistent workspace conversations, audited isolated runs, and strict single-model GPU residency.
Milestone 11 operational validation is documented in [docs/milestone-11-operational-validation.md](docs/milestone-11-operational-validation.md).

## Where it runs

The harness source lives in this repository, but the installed command targets the Git workspace containing the current directory. It works from the repository root or any nested package in a monorepo. Each run creates an isolated `agent/<run-id>-<slug>` branch/worktree and stores auditable artifacts under `.agent-harness/runs/<run-id>/` in the target project. It never merges into the default branch.

For IDE use, open the project you want to change and run the installed `harness` CLI in the integrated terminal (or a future IDE task). OpenCode provides agent sessions and tools; this harness owns deterministic stage transitions, permissions, gates, evidence, and recovery.

## Foundation setup

```bash
npm install
cp config/harness.example.yaml config/harness.yaml
npm run dev -- model prepare
npm run check
npm test
npm run dev -- doctor --config config/harness.yaml
```

With OpenCode and the llama.cpp router running, open any personal project in the IDE and use its integrated terminal:

```bash
harness --new "adicione validação, testes e atualize a documentação"
harness continue "agora cubra também os casos de erro"
harness chat
harness status
harness logs <run-id> --follow
```

`run` is the default command, `--repo` defaults to the containing Git root, and an inline task replaces the requirement-file ceremony. The first command creates a conversation; later `run` or `continue` commands select the latest conversation in that Git workspace unless `--new` or `--conversation <id>` is supplied. `chat` provides a multi-prompt TTY loop with `/status`, `/memory`, and `/exit`. Existing explicit usage remains supported with `harness run --repo /path --requirements requirements.md --config harness.yaml`. Configuration discovery checks `--config`, `HARNESS_CONFIG`, `.agent-harness/harness.yaml`, `config/harness.yaml`, and finally the packaged local configuration, in that order.

Conversation memory survives terminal and IDE restarts under `.agent-harness/conversations/<conversation-id>/`. It is bounded and deterministically compacted; it is not an indefinitely retained model chat session. Every prompt still creates a fresh audited run and fresh role/reviewer sessions. A successful next turn starts from the exact commit produced by the previous turn, in a new isolated worktree. The command prints that worktree path so it can be opened in the IDE. No conversation turn is merged into the project's default branch automatically.

`resume` reconciles persisted state with Git and classifies a clean pre-edit restart, a matching checkpoint, or manual reconciliation. Dirty editing work is never reset or discarded. `abort` writes a cooperative pause request consumed between workflow stages, and `report` creates a SHA-256 artifact index plus human-readable recovery summary.

While a run is active, `harness handoff <run-id> --repo /absolute/project` requests a manual handoff at the next safe model-action boundary.

`model prepare` resolves the three exact Hugging Face cache artifacts, fingerprints them, and generates ignored `config/models.local.yaml`, `config/models.local.ini`, and `config/opencode.local.json` files. It never downloads or substitutes a model. Export `LLAMA_API_KEY` outside the repository, then use `harness model list|status|start|switch|smoke|stop` for manual IDE diagnostics. Stable aliases—not role names—are sent to llama.cpp.

Only one large model may reside in VRAM. A role change finishes its response and any validated handoff, confirms the previous alias is unloaded, waits for NVIDIA VRAM usage to fall to `runtime.modelUnloadVramThresholdMiB`, and only then loads the next alias. `modelShutdownTimeoutMs` fails closed: the next model is not started if resources remain occupied. The last model is unloaded when the workflow exits.

The exit code is `0` only when required prerequisites pass. Missing OpenCode/llama.cpp runtimes are displayed as `BLOCKED` and exit with code `4`; invalid configuration exits with code `2`. This makes `doctor` suitable for CI/setup checks without hiding an incomplete machine setup.

See [compatibility report](docs/compatibility-report.md) and [implementation plan](docs/implementation-plan.md).

Project-specific advanced verification commands use normalized, fail-closed adapters documented in [Milestone 5 advanced verification](docs/milestone-5-verification.md). The harness never guesses a test or mutation tool for the target repository.

Context accounting, deterministic Markdown handoffs, semantic abstraction boundaries, bootstrap verification, and the emergency compaction fallback are documented in [Milestone 6 context continuity](docs/milestone-6-context-continuity.md).

Dashboard sections, JSONL events, machine-metric behavior, and IDE/non-TTY usage are documented in [Milestone 7 visual feedback](docs/milestone-7-visual-feedback.md).

Recovery, security, reproducibility, E2E evidence, and remaining runtime-dependent validation are documented in [Milestone 8 hardening](docs/milestone-8-hardening.md).

Persistent multi-prompt sessions, bounded memory, IDE commands, and fail-closed continuation are documented in [Milestone 9 conversations](docs/milestone-9-conversations.md).

Strict sequential model unload/load behavior and handoff ordering are documented in [Milestone 10 single-model residency](docs/milestone-10-single-model.md).

The optional local runtime and all three production role models have been validated sequentially on the target RTX 5060 Ti. See [Milestone 3 live validation](docs/milestone-3-validation.md) for versions, fingerprints and evidence.
