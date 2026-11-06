# Production Orchestrator VS Code extension

This extension contributes a reusable **Orquestrador** agent to the VS Code Chat agent picker and tools for initializing project guidance, installing/checking `lich` and `ai-memory`, delegating bounded work through `lich`, synchronizing configured upstream repositories, and building a project.

The extension is project-neutral. Each project owns its requirements in `.ai/specs/`, and receives generic procedures in `.ai/skills/`. Use the **Orquestrador** activity bar view for settings and project setup.

## Project configuration

The **Configurações** view exposes the build executable, arguments, working directory, timeout, upstream repositories, and optional tool command overrides. The extension stores these values in `.ai/orchestrator.json`; users do not need to edit that file manually.

The **Preparar projeto (.ai)** button is enabled only when the workspace has no `.ai` path. It creates `.ai/specs`, `.ai/skills`, the bundled generic skills, and initial settings. If `.ai` already exists, the button is disabled and initialization makes no changes.

Declare source repositories and build details in the Configurações view. The extension performs fetch plus fast-forward-only merge and refuses dirty repositories. `#syncAndBuildProject` performs this synchronization before invoking the configured build.

## Tools

- `#initializeProjectGuidance` creates `.ai/specs`, `.ai/skills`, and a starter configuration without overwriting files.
- `#checkOrchestratorTools` checks the local `lich` and `ai-memory` commands.
- `#listLichSessions` lists live sessions.
- `#delegateWithLich` starts a bounded specialist session, with VS Code confirmation.
- `#syncProjectUpstreams` fast-forward updates only configured upstreams, with confirmation.
- `#syncAndBuildProject` syncs first and then runs the configured build, with confirmation.

On first activation, the extension downloads the pinned official Windows x64 release assets, verifies their SHA-256 digests, installs them under VS Code user storage, and runs `ai-memory setup --yes`. It does not package upstream binaries into the VSIX. The setup may update per-user agent configuration so ai-memory can provide its MCP memory and handoff tools.

For each release package, `npm run package` checks the latest stable GitHub releases and pins their tags, asset URLs, and hashes in `upstream-releases.json`. The extension then installs exactly the versions recorded in that package; the next extension release can pick up newer upstream versions. This gives each published VSIX a reproducible dependency set.

## Platform and licensing notes

The automatic installer currently supports Windows x64. The current ai-memory support matrix marks native Windows experimental; Linux/macOS installers and validation still need to be added before claiming cross-platform support. Lich's current releases use AGPL-3.0-only, so the extension fetches its official release at install time instead of redistributing the binary.

The Chat agent uses VS Code's current custom-agent contribution rather than the deprecated chat participant API. The Python implementation is being retired in favor of this extension workflow.
