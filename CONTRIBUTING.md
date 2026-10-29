# Contributing

Short version: **`npm run verify` green = the bar.** It runs lint → typecheck →
test → build, the same gate CI runs on Node 18/20/24. A change is not done until
it is green, with **zero Prisma installed and no database running** — that is
the standing proof of the zero-coupling design, not an accident.

## Before you change code

Read [AGENTS.md](./AGENTS.md) (rules + review checklist) and
[ARCHITECTURE.md](./ARCHITECTURE.md) (layer boundaries). The short form:

1. **Zero Prisma coupling** — no runtime or type imports from `@prisma/client`,
   `prisma`, or generated code; no `dependencies`/`peerDependencies`. All types
   are extracted structurally from the delegate.
2. **Dialects are data, not branches** — per-DB behavior lives in
   `src/dialects/capabilities.ts`; database names may appear only in
   `src/dialects/`. Recipe: `.claude/skills/add-dialect/SKILL.md`.
3. **Types never lie** — projection changes must widen, never narrow below
   runtime truth, and need strict `Expect<Equal<A, B>>` assertions in
   `test/types/*.type-test.ts` (verified by `npm run typecheck`, not vitest).
4. **Limitations are documented, not hidden** — open gaps live in the README
   (`Known limitations`); do not extend one's code path, and when you fix one,
   update the README and add a regression test in the same change.

## Where things live

- `src/core/` — the stateful fluent builder + pure `conditions.ts`/`pagination.ts`.
- `src/types/` — the structural contracts and the compile-time projection engine.
- `src/dialects/` — capability registry (pure data + resolution order).
- `test/unit/` — runtime behavior against recorded fake delegates;
  `test/types/` — compile-time projection shapes. Fixtures in
  `test/helpers/fake-delegate.ts` are hand-written and Prisma-free on purpose.
- `dist/` and `builder-old/` are never source — don't edit or import from them.

Docs are single-sourced: design in ARCHITECTURE.md, working rules in AGENTS.md,
behavior contracts and known limitations in the README. Behavior changes update
the README "Behavior contracts" section in the same change.

## Working with AI agents (Claude Code)

- `.claude/agents/design-rules-auditor` — run after non-trivial `src/`/`test/`
  changes; enforces the checklist above.
- `.claude/agents/release-gate` — full pre-publish gate before version bumps.
- `.claude/skills/prisma-*` — the official Prisma Agent Skills (pinned in
  `skills-lock.json`; refresh with `npx skills update -p`). They are reference
  material; the zero-coupling rule overrides anything they suggest.
- `.mcp.json` wires the official Prisma MCP server (`https://mcp.prisma.io/mcp` —
  docs search; OAuth sign-in on first connect) and Context7 (no auth). No MCP?
  Prisma docs are also at `https://www.prisma.io/docs/llms.txt`, or append
  `.md` to any docs URL.

## Releases

`prepublishOnly` runs the verify gate; the `release-gate` agent additionally
checks the tarball file list, coupling sweep, scope drift, and the
known-limitations review. Semver applies to the `src/index.ts` exports plus the
README behavior contracts.
