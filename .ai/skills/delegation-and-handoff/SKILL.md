---
name: delegation-and-handoff
description: Delegate independent work through lich and preserve concise cross-agent continuation context with ai-memory.
---

# Delegation and handoff

1. Delegate only a task that can be completed independently with a concrete deliverable and a bounded scope.
2. Use lich to inspect current sessions first. Avoid two agents editing the same files; prefer a separate worktree for concurrent changes.
3. Include relevant spec paths, constraints, and required evidence in the delegated task. Ask the worker to report files, commands, results, and unresolved issues.
4. Inspect the worker's diff and verify its claims before integrating anything.
5. At a meaningful pause or completion, use ai-memory's handoff flow so another supported agent can resume. Keep the handoff focused on current state, last result, blocker, next action, and files to inspect.
6. Store cross-project preferences in the user's memory profile; keep project architecture and decisions in that project's `.ai/specs/`.
