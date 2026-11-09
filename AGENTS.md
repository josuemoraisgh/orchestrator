# Orchestrator-AI — Engineering Protocol

This repository builds a generic VS Code extension that contributes the
Orquestrador custom agent. It coordinates software production for any project
through its own task/session runtime, supported VS Code and provider APIs, Git
worktrees, and the managed AI Memory runtime. Lich is a behavioral reference;
the remaining compatibility adapter is transitional and must not become a new
product dependency.

## Start of work

1. Read this file and the active product specification in `.ai/specs/`.
2. Inspect the relevant extension sources, project status, and existing local
   changes before editing.
3. Use the workflows in `.ai/skills/` or the bundled skills under
   `vscode-extension/skills/` as applicable.
4. For cross-session or cross-agent continuity, use ai-memory when configured;
   project requirements and decisions stay in `.ai/specs/`.
5. Lich may be inspected read-only as a design reference, as explicitly
   requested by the user. Implement equivalent behavior independently through
   supported VS Code/provider interfaces and Git. Do not copy Lich source,
   assets, or private protocols. Use AI Memory's supported runtime/API and
   preserve its required license notices.

## Engineering loop

Work through request → source trace → smallest falsifiable hypothesis → useful
experiment → evidence → minimal correction → build → relevant checks → review.
State assumptions and distinguish measured results, source-proven facts, and
inference. Preserve user changes and avoid unrelated edits.

## Safety

- Do not commit, push, reset, clean, or discard work unless explicitly asked.
- Do not update repositories outside the workspace configuration.
- Upstream synchronization is fast-forward-only. Stop on dirty or divergent
  trees and preserve their contents.
- Run project build commands only after synchronizing configured upstreams via
  the extension workflow. Keep the resolved versions and hashes in release
  metadata.
- Ask for review before destructive operations, public releases, or changes
  whose behavior cannot be established from the available project evidence.

## Project memory layout

Every initialized project uses:

- `.ai/specs/` for product requirements, architecture decisions, and acceptance
  gates local to that project.
- `.ai/skills/` for reusable procedures that tell agents how to perform work.
- ai-memory for searchable continuity and handoff across agent sessions and
  projects.

The project may add rules and skills; do not overwrite existing files during
initialization or updates.

## Release status

Each extension release build must query the latest stable releases of lich and
ai-memory, require the expected platform assets and SHA-256 digests, and record
their exact versions, URLs, and digests in `vscode-extension/upstream-releases.json`.
The extension installs only the pinned assets from its own package and verifies
each downloaded archive before extraction. It must not execute an unverified
installer or silently accept a missing digest.

## VS Code validation

When validating an installed extension, leave the user's active VS Code window untouched. Install the candidate package for the same user profile, open a separate VS Code window with the target workspace, and inspect that window's extension-host log and runtime behavior. Do not claim runtime validation if the separate window or target workspace could not be opened. After validation, close every test window gracefully and verify that its VS Code process tree exited before finishing the turn. Identify test processes by their dedicated `--user-data-dir` and `--extensions-dir`; never close a process belonging to the user's regular profile. Avoid leaving multiple candidate windows open between test runs.
