# Nada Dev Skills

Personal Codex skill pack, modeled on the portable SKILL.md pattern seen in REA.
This is an original instruction-only pack, **not** a fork or replacement of REA's reverse-engineering engine.
It does not install an MCP server or provide new executable capabilities.

## Install for one Codex project
Copy the four skill folders into `<project>/.agents/skills/` and copy `AGENTS.md` to `<project>/AGENTS.md`.
Restart/reopen Codex if necessary and ask it to use the named skill.

## Install as user-level Codex skills
Copy the skill folders into `~/.agents/skills/` (check your Codex version's supported skills path).
Do not overwrite existing folders without reviewing them.

## Sample prompt
Use nada-architecture, nada-ui-design and nada-quality-gate to inspect this repository, propose a plan, implement approved changes, and report test evidence. Do not deploy.

## Scope
Skills are prompt instructions. To access external apps or run REA itself, configure supported tools/MCP separately.
