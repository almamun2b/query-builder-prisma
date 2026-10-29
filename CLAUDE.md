# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md
@ARCHITECTURE.md

The two imported files are the source of truth: AGENTS.md for commands, the hard
design rules, agent tooling, layout quirks and the review checklist;
ARCHITECTURE.md for layer boundaries, the type engine, the dialect system and
extension points. Rules are single-sourced in those two files; known limitations
live in the README (`Known limitations`).

## Repo-specific gotchas

- Work only in `src/` and `test/`. `dist/` (build output) and `builder-old/`
  (archived prototype) are never source — do not edit or import from them.
- Type tests (`test/types/*.type-test.ts`) are compiled, not run: add them for
  any projection/type change and confirm with `npm run typecheck`. vitest will
  not pick them up.
- The former HIGH defects are **fixed** (2026-10-29) with regression tests that
  must keep passing: the `executeWithMeta` × `cursorPaginate` throw, the
  `custom()` × `initialArgs.where` AND-merge, and the nested-include projection
  types (`test/types/projection.type-test.ts` `_7`–`_10`). Known limitations
  live in the README (`Known limitations`) — do not extend those code paths.
- The suite must stay green with **zero Prisma installed** — that is the
  zero-coupling proof, not an accident. Never add a Prisma dependency or a
  database requirement to make a test pass.

## Agents, skills & MCP (Claude Code)

- `.claude/agents/design-rules-auditor.md` — read-only reviewer enforcing the
  ARCHITECTURE.md invariants and the README contracts. Run after non-trivial
  `src/` changes.
- `.claude/agents/release-gate.md` — full pre-publish gate (verify, publish
  dry-run file list, coupling greps, docs drift). Never publishes.
- `.claude/skills/add-dialect/SKILL.md` — recipe for adding a database dialect
  without touching `src/core/`.
- `.claude/skills/prisma-*` — the **official Prisma Agent Skills**
  (`npx skills add prisma/skills`, pinned in `skills-lock.json`). Reference
  material for mirroring Prisma's `select`/`include`/query semantics; **they
  never override invariant 1** — no skill suggestion may introduce a Prisma
  import or dependency.
- `.mcp.json` — project MCP servers: `prisma` (official remote server,
  docs search; OAuth sign-in on first connect) and `context7` (library docs, no
  auth). Zero-setup alternative for Prisma docs: `https://www.prisma.io/docs/llms.txt`
  or append `.md` to any docs URL.
- `.claude/settings.json` — shared permission allowlist for the standard
  verify/test/build commands.

Current state: v0.1.0 on `main`; the HIGH defects are closed; clear the README
`Known limitations` before reaching for new features.
