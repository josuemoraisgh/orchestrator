---
name: delegation-and-handoff
description: Delegate independent work through Orchestrator provider sessions and preserve task-scoped continuation context with AI Memory.
---

# Delegation and handoff

1. Delegate only a task with a bounded scope, independent deliverable, and explicit acceptance criteria.
2. Use the Orchestrator task board and its provider-session adapters to inspect active work. Avoid overlapping file ownership; use an isolated Git worktree for concurrent changes when available.
3. Include relevant `.ai/specs/` requirements, constraints, and required evidence. Ask the worker to report files changed, commands and results, decisions, failed attempts, and open questions.
4. Inspect the worker's diff and verify its claims before integrating anything.
5. For continuation, preserve the task ID and task-scoped memory context. A replacement agent must read the prior context before editing and record its own decisions and results. Keep handoffs focused on objective, completed work, blocker, next action, and files to inspect.
6. Use AI Memory's supported project/task mechanisms when configured; do not claim that a handoff or memory write succeeded without read-back verification. The Orchestrator task journal is the fallback and must be identified as such.
7. Lich may be consulted as a read-only design reference or used by the compatibility adapter. Do not copy its source, assets, or private protocols into Orchestrator-owned code.
8. Store cross-project preferences in the user's memory profile; keep project architecture and decisions in that project's `.ai/specs/`.
