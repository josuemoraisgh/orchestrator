# Production Orchestrator for VS Code

The active orchestrator is now the VS Code extension in
[`vscode-extension/`](vscode-extension/README.md). It contributes an
**Orquestrador** custom agent to VS Code Chat, works in any open project, uses
lich for independent specialist sessions, and relies on ai-memory for shared
project recall and cross-agent handoffs.

The old Python UI automation runner has been moved to `legacy-python/` for
reference. It is no longer the active workflow. The former QEMU investigation
notebook is archived in `legacy-python/qemu-ai-history/`; it no longer defines
the extension's scope or instructions.

## Extension development

The extension package is `vscode-extension/`.

```powershell
cd vscode-extension
npm install
npm run package
```

`npm run package` first looks up the latest stable lich and ai-memory releases,
requires their Windows x64 assets and GitHub SHA-256 digests, writes the exact
versions and hashes to `upstream-releases.json`, then packages the VSIX. A
release cannot be produced if an upstream asset or digest is missing.

Install the resulting VSIX in VS Code. On first activation the extension
downloads the pinned release archives to VS Code user storage, verifies their
hashes, safely extracts them, and runs `ai-memory setup --yes`. The
Orquestrador agent then appears in the Chat agent selector.

## Use in a project

Open any project folder and select the **Orquestrador** activity bar view. If
`.ai` is absent, click **Preparar projeto (.ai)**. The button is disabled when
`.ai` already exists; initialization does not alter existing project files.
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
and optional tool executable overrides in **Orquestrador → Configurações**.
The extension maintains `.ai/orchestrator.json` internally.

Before compiling, `#syncAndBuildProject` fetches each declared upstream and
performs a fast-forward-only merge, then runs the configured build. It stops
and preserves local work if an upstream is dirty, diverged, or unavailable.
Projects without external source repositories should leave `upstreams` empty.

## Current implementation boundary

The first extension increment includes the custom agent, bundled skills,
dependency release pinning/install, lich delegation tools, project
initialization, and sync-before-build. It is currently Windows x64 only. The
upstream ai-memory project labels its native Windows support experimental, so
that setup needs a real VS Code validation pass before calling the whole
workflow production-ready. See `.ai/specs/PRODUCT.md` for the full acceptance
criteria and remaining work.
