---
name: implementation-cycle
description: Implement a scoped change through source tracing, minimal edits, relevant validation, and adversarial review.
---

# Implementation cycle

1. Trace the requested behavior to its current implementation and identify the smallest failure or missing behavior.
2. Use a bounded experiment when it can distinguish competing causes before editing.
3. Make the smallest correction that addresses evidence; preserve public interfaces unless the spec authorizes a change.
4. Run the project's declared build and focused tests. Run broader gates when the change reaches shared infrastructure or release behavior.
5. Review the diff for unrelated edits, unsafe defaults, missing failure paths, and claims unsupported by results.
6. Report exact commands and outcomes. Do not say “passed” if a gate was skipped.
