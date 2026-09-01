# Local Multi-Agent Engineering Harness

Foundation for a local-only engineering orchestrator using OpenCode and llama.cpp. The current implementation stops at Milestone 3 and includes typed OpenCode sessions/events plus router and explicit-process llama.cpp lifecycle adapters. The deterministic multi-agent workflow itself begins in Milestone 4.

## Where it runs

The harness source lives in this repository, but it is designed to target any explicitly supplied Git repository. From Milestone 2 onward, each run will create an isolated `agent/<run-id>-<slug>` branch/worktree and store auditable artifacts under `.agent-harness/runs/<run-id>/` in the target project. It will never merge into the default branch.

For IDE use, open the project you want to change and run the installed `harness` CLI in the integrated terminal (or a future IDE task). OpenCode provides agent sessions and tools; this harness owns deterministic stage transitions, permissions, gates, evidence, and recovery.

## Foundation setup

```bash
npm install
cp config/harness.example.yaml config/harness.yaml
npm run check
npm test
npm run dev -- doctor --config config/harness.yaml
```

Set absolute GGUF paths in `modelFiles`. Keep API keys in environment variables or protected files; never put secrets in YAML.

The exit code is `0` only when required prerequisites pass. Missing OpenCode/llama.cpp runtimes are displayed as `BLOCKED` and exit with code `4`; invalid configuration exits with code `2`. This makes `doctor` suitable for CI/setup checks without hiding an incomplete machine setup.

See [compatibility report](docs/compatibility-report.md) and [implementation plan](docs/implementation-plan.md).
