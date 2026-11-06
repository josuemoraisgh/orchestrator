---
name: spec-driven-change
description: Turn a production request into a small, falsifiable specification and acceptance criteria before implementation.
---

# Spec-driven change

1. State the user-visible result and affected interfaces.
2. Separate requirements, constraints, and assumptions. Do not invent a product domain.
3. Define observable acceptance criteria, relevant tests, and failure conditions.
4. Save substantial or cross-cutting specs in `.ai/specs/` with scope, decision history, and status.
5. Choose the smallest implementation that meets the criteria. Revise the spec when evidence changes it.
