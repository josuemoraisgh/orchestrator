# Product: Production Orchestrator VS Code extension

Status: in progress

## Goal

Provide one generic Orquestrador agent in VS Code Chat that coordinates the
production lifecycle of software projects using the user's configured agent
providers through lich and shared knowledge/handoffs through ai-memory.

## Project layout

When initialized, any target project receives `.ai/specs/` for project-local
requirements and decisions, and `.ai/skills/` for reusable task procedures.
Initialization is additive and must never replace user files. The extension
ships generic skills and installs them into each project.

Project-level settings are edited in a dedicated **Configurações** view in the
VS Code activity bar. It exposes the build executable, arguments, working
directory, timeout, upstream repositories, and optional tool executable
overrides. The JSON file is internal storage, not the user-facing settings
workflow.

The view includes **Preparar projeto (.ai)**. It is available only when the
workspace has no `.ai` path. If `.ai` exists, initialization makes no changes.

## Production workflow

1. Inspect project instructions, requirements, build configuration, current Git
   changes, and project-specific acceptance gates.
2. Retrieve applicable prior context from ai-memory.
3. Plan a bounded change and state how success will be measured.
4. Delegate independent work through lich where that helps; inspect delegated
   diffs and evidence before integration.
5. Synchronize only configured upstream source repositories before compiling.
   Use fast-forward-only updates and stop on local changes or divergence.
6. Run the declared build and relevant validation gates, then review the diff
   and report exact results.
7. Save a concise handoff through ai-memory and update project-local specs when
   durable decisions changed.

## Dependency lifecycle

- On first extension activation, install official pinned lich and ai-memory
  assets in VS Code user storage, verify SHA-256 before extraction, then run
  ai-memory setup.
- When packaging each new extension version, query each upstream GitHub
  repository's latest stable release and pin its exact tag, asset URL, and
  SHA-256 digest in `upstream-releases.json`.
- The package must fail if a stable release, expected asset, or digest is
  unavailable. Do not bundle upstream executable binaries in the VSIX.
- Initial automatic asset support is Windows x64. Do not claim other platforms
  until their assets, install paths, and validation are implemented.

## Acceptance criteria

- The extension contributes an `Orquestrador` custom agent to the VS Code Chat
  agent selector.
- The activity bar exposes project settings and a preparation button that
  creates the initial `.ai` structure only when `.ai` is absent.
- Build, upstream, and executable settings can be changed in the view without
  manually editing JSON.
- The agent can initialize `.ai/specs` and `.ai/skills` additively and install
  its bundled generic skills.
- It can check tool availability, list/delegate lich sessions, and invoke a
  configured project build only after configured upstreams update safely.
- Downloads are pinned per extension release and verified before extraction.
- The agent uses ai-memory integrations for project recall and handoff when
  configured, and explains a missing integration instead of claiming memory
  was consulted.
- No domain-specific QEMU, LasecSimul, or fixed project-root assumptions remain
  in active extension instructions.

## Open work

- Validate the VS Code agent and tool contribution end to end.
- Validate upstream archive layouts, ai-memory setup behavior, and update flow
  on Windows x64.
- Add and validate Linux/macOS install targets if they are needed.
- Complete migration from the archived Python runner to the extension package
  workflow and document the release process.
