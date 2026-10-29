---
name: add-dialect
description: Recipe for adding a new database dialect (or a new per-DB capability) to this query builder without touching src/core/. Use when a newly supported Prisma database needs support or when per-database behavior differs.
---

# Adding a database dialect

The architecture rule: a new database is **data, not code** (ARCHITECTURE.md,
invariant 4). Never branch on a database name outside `src/dialects/`.

## Case A — new database, existing capabilities suffice

1. Add one entry to `DIALECT_CAPABILITIES` in `src/dialects/capabilities.ts`.
   The `satisfies Record<string, DialectCapabilities>` constraint refuses entries
   with missing flags — that check IS the extension protocol.
2. Add a registry-level test in `test/unit/dialects.test.ts`
   (`resolveDialect('<name>')` returns the right flags).
3. Add a builder-level test in `test/unit/query-builder.test.ts` asserting the
   args actually sent with `{ dialect: '<name>' }` — e.g. `search()` emitting or
   omitting `mode: 'insensitive'`.
4. Update the DB list in `README.md` — the code table in
   `src/dialects/capabilities.ts` is the capability source of truth.

## Case B — new per-DB behavior (new capability flag)

1. Add the flag to `DialectCapabilities` with a JSDoc sentence saying when a
   database has it.
2. Add the flag to every existing entry, **including `universal`** — universal
   must stay maximally conservative (never emit an argument that is invalid
   anywhere).
3. Consume it in the builder method via
   `resolveDialect(this.dialect).capabilities.<flag>` — no name checks anywhere.
4. Tests: one per representative dialect (has-flag / lacks-flag / universal) at
   the builder level, plus a registry-level test.
5. Run the audit grep — output must be empty:
   `grep -rniE "postgres|mysql|maria|sqlite|sqlserver|cockroach|mongo" src/core/ src/types/`
6. `npm run verify` green.

## Never

- Never touch `src/core/` or `src/types/` for dialect-specific behavior. If that
  seems necessary, stop and design a capability flag instead.
- Never let `universal` emit an argument that is invalid on any Prisma-supported
  database.
