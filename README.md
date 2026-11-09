# Orchestrator-AI

Orchestrator-AI is a project-neutral VS Code extension that provides a
dedicated coordinator chat and task board alongside the editor's existing
provider chats. The coordinator can use a model from the VS Code Language Model
API or a read-only Claude/Codex CLI profile. Orchestrator owns its Claude Code,
Codex app-server, and VS Code model worker sessions; Lich remains a compatibility
executor for providers without a first-party adapter. AI Memory supplies
verified shared project context where its supported bridge is available.

The current implementation supports reviewable plans, task dependencies,
parallel provider workers, isolated Git worktrees with a selected local base
branch, `.worktreeinclude` seeding for explicitly selected ignored files,
pause/cancel/retry/handoff controls, live per-task changed-file tracking, a
bounded tracked-file diff preview, and human review before completion. Before
launching supported Claude and Codex workers, the coordinator verifies the
AI Memory task page and provides scoped task-memory tools; the Lich compatibility
path receives bounded context and reports its actual memory verification
status. Missing worker reports may get a clearly attributed coordinator
fallback created with `create_only` and verified by read-back; existing reports
are never overwritten. Lich-launched sessions are not linked to AI Memory
managed workstreams through its public launcher. Visible untracked Lich
sessions in the same project occupy parallel slots when a Lich task is
scheduled: `busy`, `waiting`, and unknown states count conservatively, while
`done` is free. Orchestrator reservations are coordinated across VS Code
profiles for the same OS user; separate OS user accounts have independent
ledgers.

Claude/Codex CLI profiles can be named, authorized, authenticated through the
official CLI login, and checked before each coordinator request or assigned
worker task. Claude profiles can use separate documented configuration
directories. Isolated Codex profiles use separate `CODEX_HOME` directories with
the documented `cli_auth_credentials_store = "file"` option, so each
CLI-managed `auth.json` belongs to that profile rather than a shared keyring.
The file is not encrypted by the Orchestrator. CLI coordinators run in
read-only planning mode and receive an AI Memory briefing plus verified page
excerpts for active board tasks when its read tools are available. VS Code
language models remain available when published by the provider API. The task
board shows observed session state, file changes, handoffs, and results; it
does not stream agent transcripts.

Claude/Codex tasks can select among authorized Orchestrator CLI profiles and
set a supported model and effort. Multiple Copilot/Gemini CLI identities and
provider plan quotas still require official interfaces that expose and verify
those capabilities. The extension does not extract credentials from other VS
Code extensions or switch accounts to evade provider limits. Coordinator
effort is passed to Claude/Codex CLIs when selected; VS Code Language Model
requests have no generic effort field.

See [the product and engineering guide](README_ORCHESTRATOR.md), the
[extension guide](vscode-extension/README.md), and
[the acceptance specification](.ai/specs/PRODUCT.md) for setup, build, and
remaining work.
