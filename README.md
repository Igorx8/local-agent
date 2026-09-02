# Local Multi-Agent Engineering Harness

Foundation for a local-only engineering orchestrator using OpenCode and llama.cpp. The current implementation reaches Milestone 6: typed local runtimes, deterministic engineering and verification workflows, exact/estimated context accounting, projected-overflow handoffs, validated session bootstrap, and emergency compaction continuity.

## Where it runs

The harness source lives in this repository, but it is designed to target any explicitly supplied Git repository. From Milestone 2 onward, each run will create an isolated `agent/<run-id>-<slug>` branch/worktree and store auditable artifacts under `.agent-harness/runs/<run-id>/` in the target project. It will never merge into the default branch.

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

With OpenCode and the llama.cpp router already running and the production model aliases configured:

```bash
npm run dev -- run --repo /absolute/project --requirements /absolute/requirements.md --config config/harness.yaml
npm run dev -- status <run-id> --repo /absolute/project --json
```

`resume` currently refuses interrupted editing stages safely; Git/session reconciliation is deliberately reserved for the recovery hardening milestone.

While a run is active, `harness handoff <run-id> --repo /absolute/project` requests a manual handoff at the next safe model-action boundary.

`model prepare` resolves the three exact Hugging Face cache artifacts, fingerprints them, and generates ignored `config/models.local.yaml`, `config/models.local.ini`, and `config/opencode.local.json` files. It never downloads or substitutes a model. Export `LLAMA_API_KEY` outside the repository, then use `harness model list|status|start|switch|smoke|stop` for manual IDE diagnostics. Stable aliases—not role names—are sent to llama.cpp.

The exit code is `0` only when required prerequisites pass. Missing OpenCode/llama.cpp runtimes are displayed as `BLOCKED` and exit with code `4`; invalid configuration exits with code `2`. This makes `doctor` suitable for CI/setup checks without hiding an incomplete machine setup.

See [compatibility report](docs/compatibility-report.md) and [implementation plan](docs/implementation-plan.md).

Project-specific advanced verification commands use normalized, fail-closed adapters documented in [Milestone 5 advanced verification](docs/milestone-5-verification.md). The harness never guesses a test or mutation tool for the target repository.

Context accounting, deterministic Markdown handoffs, semantic abstraction boundaries, bootstrap verification, and the emergency compaction fallback are documented in [Milestone 6 context continuity](docs/milestone-6-context-continuity.md).

The optional local runtime and all three production role models have been validated sequentially on the target RTX 5060 Ti. See [Milestone 3 live validation](docs/milestone-3-validation.md) for versions, fingerprints and evidence.
