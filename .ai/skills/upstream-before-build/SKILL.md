---
name: upstream-before-build
description: Keep configured upstream source repositories current before compiling while preserving reproducibility and local work.
---

# Upstream before build

1. Inspect `.ai/orchestrator.json` and identify only the declared upstream repositories, remotes, and branches.
2. Call `#syncProjectUpstreams` before a build. It fetches and applies fast-forward-only updates and records resulting HEADs.
3. Stop if an upstream has local changes, diverged history, a missing remote, or a failed fetch. Preserve the tree and report the exact blocker.
4. Run `#syncAndBuildProject` to make sync-before-build one operation. Do not compile against a partially synchronized set.
5. Report each upstream commit and build command/output so the result is reproducible. Never use reset, force, or clean as an update strategy.
