# Nada development standards

For website and software tasks, consult the relevant local skill under `.agents/skills/` (mirrored in `.claude/skills/`):
- `nada-ui-design` for frontend and visual design
- `nada-architecture` for application design, data models and access control
- `nada-quality-gate` for validation, testing and release readiness
- `nada-feature-research` for studying existing feature behavior

Priorities: correctness > security > maintainability > aesthetics > speed.
Never claim to have deployed, tested, or changed external systems unless verified.
Do not modify production systems or databases without explicit approval.
For PAC-related systems, keep work isolated to authorized sandbox environments unless approved.

Project specifics: English-only UI. All dashboard figures come from database queries. Migrations are additive; seeding is idempotent and never overwrites existing rows. See `docs/ADR-001-architecture.md`.
