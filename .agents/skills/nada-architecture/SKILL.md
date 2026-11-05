---
name: nada-architecture
description: Plan and review maintainable full-stack architecture, databases, APIs and permissions before implementation.
---

# Workflow
1. Inspect repository and identify actual stack; do not invent infrastructure.
2. Document requirements, actors, data boundaries, dependencies, trust boundaries and nonfunctional constraints.
3. Produce a concise architecture decision record (ADR): options, tradeoffs, selected design, rollback.
4. Prefer simple modular architecture; separate UI, business logic, persistence and integration layers.
5. Define schema, migrations, constraints, indexes, API contracts, audit trail and access policy.
6. For multi-role apps, enforce authorization on server and database, not UI alone.
7. Address security, secrets, rate limits, error handling, observability, backup and recovery.
8. Require explicit approval before production DB changes, migrations, credential changes or deployment.
9. Include an incremental implementation and test plan.
