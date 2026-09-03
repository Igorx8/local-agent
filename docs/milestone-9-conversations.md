# Milestone 9 — persistent workspace conversations

Milestone 9 adds a user-facing conversation above the existing workflow. It provides continuity across prompts without weakening the workflow's independent roles, reviews, Git isolation, gates, or audit trail.

## IDE workflow

From any directory inside the target Git repository:

```bash
harness --new "implement the first change"
harness continue "add validation and tests"
harness chat
```

`harness continue conv-... "prompt"` or `harness continue --conversation conv-... "prompt"` selects a specific conversation. Without an ID, the latest non-closed conversation in the current workspace is selected. `harness chat` requires a TTY; IDE tasks and scripts should use `harness continue`.

Each result includes the conversation ID, run state, and isolated worktree path. Open that worktree in the IDE to inspect the cumulative result. The source repository's default branch is never changed or merged automatically.

## Persistence model

Conversation data is local to the target repository:

```text
.agent-harness/conversations/<conversation-id>/
├── conversation.json
├── memory.json
└── events.jsonl
```

`conversation.json` records prompt hashes/previews, ordered runs, base/final commits, status, and artifacts. `memory.json` retains a configured number of recent prompts plus deterministic compact summaries. It is bounded by `conversation.maxRecentTurns` and `conversation.maxMemoryBytes`.

This is durable harness memory, not one permanent LLM context. Each turn creates new local model sessions, including independent reviewers. The prompt receives bounded prior facts and the repository itself carries the authoritative cumulative code state.

## Continuation guarantees

- The first turn starts from the current repository commit.
- A later turn starts from the exact final commit of the preceding successful turn.
- A new branch and worktree are created for every run.
- A failed, paused, escalated, dirty, missing, or commit-mismatched prior turn blocks continuation.
- The conversation lock prevents concurrent turns from racing.
- `.agent-harness/` is added to the repository-local Git exclude file, not committed to the user's project.
- No default-branch merge is performed.

If a turn is blocked, recover or resume the reported run before attempting the next prompt. Starting with `--new` deliberately creates a separate history from the workspace's current commit.

## Validation

Automated tests cover cumulative commit ancestry, bounded deterministic memory, persisted prompt/run relationships, and fail-closed behavior after an unsuccessful turn. Full live multi-model conversation validation remains runtime-dependent and must be reported as blocked whenever the configured local services are unavailable.
