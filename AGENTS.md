# AGENTS.md

Guidance for AI coding agents (and human reviewers) working in this repository.
Big-picture design: [ARCHITECTURE.md](./ARCHITECTURE.md).

## What this is

`query-builder-prisma` — a zero-coupling, fluent, type-safe query
builder that wraps any Prisma model delegate. It imports nothing from Prisma; all
types are derived structurally from the delegate the user passes in. That is the
product's entire moat — every rule below protects it.

## Commands

- `npm run verify` — the full gate: lint → typecheck → test → build. CI
  (`.github/workflows/ci.yml`) runs the same four steps; `prepublishOnly` runs it
  too. A change is not done until this is green.
- Run a single test file: `npx vitest run test/unit/conditions.test.ts`.
- Watch mode: `npm run test:watch`.

No Prisma install or database is ever required. All tests use hand-written fake
delegates (`test/helpers/fake-delegate.ts`) — this is deliberate: the suite
doubles as the zero-coupling proof.

## Hard design rules (ARCHITECTURE.md invariants — review-blocking when violated)

1. **Zero Prisma coupling, ever.** No runtime or type imports from
   `@prisma/client`, `prisma`, or generated client code. No runtime deps, no
   peerDependencies. All types are extracted structurally from the delegate the
   user passes in — the only requirement is the `findMany` + `count` call shape.
2. **Dialects are a capability registry, not if-branches.** Per-DB behavior
   (e.g. `mode: 'insensitive'` only on postgresql/cockroachdb/mongodb; it throws
   on mysql/mariadb/sqlite/sqlserver) lives in `src/dialects/capabilities.ts`.
   A new database = one capability entry / `registerDialect()` call — never touch
   `src/core/` for dialect-specific logic, and never branch on a database name
   outside `src/dialects/`.
3. **Types degrade wider, never wrong.** If the structural projection engine
   cannot mirror Prisma exactly, it must widen — a narrower-than-runtime type is
   a HIGH-severity defect. Every projection change needs a strict
   `Expect<Equal<A, B>>` test in `test/types/`.

## Architecture in one paragraph

`src/types/delegate.ts` holds the only Prisma knowledge (the structural contract
plus `Parameters<>`/`ReturnType<>` extractors). `src/types/projection.ts` is the
compile-time select/include engine. `src/core/` is the stateful fluent builder
plus two pure modules (`conditions.ts`, `pagination.ts`) that consult the dialect
registry for per-DB behavior. `src/dialects/` is pure data plus a resolution
order. Everything public is re-exported from `src/index.ts` (single tsup entry,
dual ESM+CJS). Details and layer boundaries: [ARCHITECTURE.md](./ARCHITECTURE.md).

## Before you change code

- Known limitations live in the README (`Known limitations` section) — do not
  extend one's code path silently; fixing one means updating the README and
  adding a regression test in the same change.
- Statefulness is a documented contract: one builder per query, instances are
  cheap. Do not add module-scope mutable state (dual-package hazard).
- Behavior changes must update the README "Behavior contracts" section in the
  same change — the docs assert what is true, not what is intended.

## Layout quirks

- Real source is `src/`, and everything public must be re-exported from
  `src/index.ts` (tsup builds dual ESM+CJS from that single entry).
- `test/types/*.type-test.ts` files are **compile-time only**: vitest only
  includes `test/**/*.test.ts`, so type tests are verified by
  `npm run typecheck` (tsconfig includes `test/`). They use the hand-rolled
  `Expect<Equal<A, B>>` pattern — there is no `expect-type` dependency.
- `dist/` is build output; `builder-old/` is the archived prototype this package
  was extracted from. Neither is source — do not edit or import from them.

## AI agent tooling (Claude Code)

- **Agents** (`.claude/agents/`): `design-rules-auditor` — reviews `src/`/`test/`
  changes against the invariants and the README contracts (run after non-trivial
  changes); `release-gate` — full pre-publish gate (run before any version bump
  or publish; never publishes itself).
- **Skills** (`.claude/skills/`): `add-dialect` — project-authored recipe for
  adding a database without touching `src/core/`. No Prisma-specific skills or
  MCP servers are configured: this package imports nothing from Prisma, so
  tooling for *using* Prisma has no place here (invariant 1 applies to agent
  tooling too).
- **Shared settings** (`.claude/settings.json`): permission allowlist for the
  verify/test/lint/typecheck/build commands, so agents don't re-prompt on the
  standard gate.

## Code style

- tsconfig uses `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` —
  type-only imports must use `import type`, and array/record access needs
  undefined handling.
- Prettier: single quotes, printWidth 100, semicolons, trailing commas. ESLint:
  `no-explicit-any` is off; unused vars/args must be prefixed `_`.
- Tests read like the existing suites: recorded-args assertions against the fake
  delegate for "what was sent", direct calls for pure functions, strict
  `Expect<Equal>` for type shapes.

## Review checklist (every change)

1. `npm run verify` green.
2. No `@prisma` imports anywhere; no new `dependencies`/`peerDependencies`.
3. No database names in `src/core/` or `src/types/`.
4. New public API re-exported from `src/index.ts`; README contracts updated if
   semantics changed.
5. New behavior has a unit test; new/changed projection shapes have a
   `test/types/*.type-test.ts` assertion.
