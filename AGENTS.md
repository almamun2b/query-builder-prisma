# AGENTS.md

## Commands

- `npm run verify` — the full gate: lint → typecheck → test → build. CI (`.github/workflows/ci.yml`) runs the same four steps; `prepublishOnly` runs it too.
- Run a single test file: `npx vitest run test/unit/conditions.test.ts`.
- No Prisma install or database is ever required. All tests use hand-written fake delegates (`test/helpers/fake-delegate.ts`) — this is deliberate: it doubles as the zero-coupling proof.

## Hard design rules (PLAN.md §2, enforced in review)

- **Zero Prisma coupling, ever.** No runtime or type imports from `@prisma/client`, `prisma`, or generated client code. No runtime deps, no peerDependencies. All types are extracted structurally from the delegate the user passes in — the only requirement is the `findMany` + `count` call shape.
- **Dialects are a capability registry, not if-branches.** Per-DB behavior (e.g. `mode: 'insensitive'` only on postgres/cockroach/mongodb; it throws on mysql/sqlite/sqlserver) lives in `src/dialects/capabilities.ts`. A new database = one `registerDialect()` entry — never touch `src/core/` for dialect-specific logic.

## Layout quirks

- Real source is `src/`, and everything public must be re-exported from `src/index.ts` (tsup builds dual ESM+CJS from that single entry).
- `test/types/*.type-test.ts` files are **compile-time only**: vitest only includes `test/**/*.test.ts`, so type tests are verified by `npm run typecheck` (tsconfig includes `test/`). They use the hand-rolled `Expect<Equal<A, B>>` pattern — there is no `expect-type` dependency, despite PLAN.md §3 mentioning one.

## Code style

- tsconfig uses `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` — type-only imports must use `import type`, and array/record access needs undefined handling.
- Prettier: single quotes, printWidth 100, semicolons, trailing commas. ESLint: `no-explicit-any` is off; unused vars/args must be prefixed `_`.
