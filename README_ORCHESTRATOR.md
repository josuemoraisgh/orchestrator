# Orchestrator-AI for VS Code

The active orchestrator is now the VS Code extension in
[`vscode-extension/`](vscode-extension/README.md). It contributes an
**Orquestrador** custom agent to VS Code Chat and works in any open project.
The Orquestrador tab has its own chat and persistent, reviewable task board;
standard VS Code provider chats remain independent. First-party workers use the
VS Code Language Model API, the Codex app-server, or Claude Code CLI. Lich is a
compatibility executor for providers without a first-party adapter. AI Memory
is managed privately by the extension and is reported active only after its
supported reads and writes are verified.

## Extension development

The extension package is `vscode-extension/`.

```powershell
cd vscode-extension
npm install
```

For an extension release, configure the build command as `npm` with arguments
`run package` and working directory `vscode-extension` in the Orquestrador
settings UI. Configure upstream repositories there as well, then use
`#syncAndBuildProject`; it synchronizes first and runs the configured build.
The package script looks up the latest stable lich and ai-memory releases,
requires their Windows x64 assets and GitHub SHA-256 digests, writes the exact
versions and hashes to `upstream-releases.json`, then packages the VSIX. A
release cannot be produced if an upstream asset or digest is missing.

Install the resulting VSIX in VS Code. On activation the extension opens its
own Orquestrador chat view in the Secondary Side Bar. It also downloads the
pinned release archives to VS Code user storage, verifies their hashes, safely
extracts them, and starts AI Memory in an extension-owned private data
directory. It does not configure provider CLIs or install global hooks.
The Orquestrador agent also appears in the Chat agent selector.

## Use in a project

Open any project folder. The Orquestrador view opens automatically in the
Secondary Side Bar. Use its gear menu for settings and **Preparar projeto
(.ai)**. Preparation is available only when `.ai` is absent; initialization
does not alter existing project files.
Preparation adds:

```text
.ai/
  README.md
  specs/
  skills/
  orchestrator.json
```

Existing project files are kept. Project instructions and requirements belong
in `.ai/specs/`; reusable procedures belong in `.ai/skills/`. Generic skills
for discovery, specification, implementation, delegation/handoff, and
upstream-before-build are copied from the extension package.

Configure the build command, arguments, working directory, timeout, upstreams,
coordinator model, allowed worker providers, parallelism, and
optional tool executable overrides in **Orquestrador → Configurações**. The
VS Code model API has no generic reasoning-effort option; model-specific
coordinator effort is not claimed unless a provider documents it.
The extension maintains `.ai/orchestrator.json` internally.

Before compiling, `#syncAndBuildProject` fetches each declared upstream and
performs a fast-forward-only merge, then runs the configured build. It stops
and preserves local work if an upstream is dirty, diverged, or unavailable.
Projects without external source repositories should leave `upstreams` empty.

## Current implementation boundary

Plans and task metadata persist per conversation. Worker results remain pending
review until a person checks the acceptance criteria. The first-party Claude and
Codex adapters stream visible progress, support cancellation and session
continuation, and receive task-scoped AI Memory tools only after page scope and
read/write access are verified. Lich tasks remain supported through the
compatibility path for other CLIs. Worktrees support local base branches and
explicit `.worktreeinclude` patterns for ignored files. The task board shows
session state and file changes but does not provide a generic live transcript
for every provider. The packaged installer currently supports Windows x64;
provider-backed end-to-end validation and cross-window recovery remain acceptance
gates.
See `.ai/specs/PRODUCT.md` for the full acceptance criteria and remaining work.
