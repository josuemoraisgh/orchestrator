---
name: project-discovery
description: Map an unfamiliar project's structure, build flow, constraints, and verification gates before making changes.
---

# Project discovery

1. Find the workspace root and read its agent instructions, README, package/build manifests, and CI workflows.
2. Inspect Git status before reading deeply; identify user changes and preserve them.
3. Locate the real application entry points, build targets, test commands, and project-specific release gates. Prefer declared scripts over guessed commands.
4. Read `.ai/specs/` for current behavior and requirements. Record only durable project-specific facts there; use ai-memory for cross-session handoffs.
5. Report the production path from source change through build, tests, packaging, and release. Mark unknown steps explicitly.
