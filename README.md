# query-builder-prisma

> Zero-coupling, fluent, fully type-safe query builder for any Prisma model delegate.
> **Status: v0.1.0 — core API working.** Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md)
> · Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)

Works with **every Prisma version — 5, 6, 7, 8 and future majors by design** — and every
database Prisma supports (PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, CockroachDB,
MongoDB), because it imports **nothing** from Prisma: all types are derived structurally
from the delegate you pass in.

## The idea

An npm package that imports Prisma types will break on Prisma's next major (import paths
changed in v7, the type utilities move in v8, the engine was rewritten...). This package
speaks only Prisma's stable public contract — the model-delegate call shape — so a Prisma
upgrade can never break it.

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .search({ searchText: q, fields: ['email', 'username'] }) // dialect-aware: no `mode` on MySQL/SQLite/SQLServer
  .filter({ role, status })                                  // undefined values stripped
  .range({ createdAt: { from, to }, 'avatar.size': { from: min } })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 20 })                          // or .cursorPaginate({...})
  .select({ id: true, email: true })                         // output type narrows structurally
  .executeWithMeta();
// meta: { page: 1, limit: 20, total: 142, totalPage: 8 }
```

## Design rules (enforced in review — [ARCHITECTURE.md](./ARCHITECTURE.md) invariants)

1. **Zero Prisma coupling** — no runtime or type imports from Prisma; no peerDependencies.
2. **Everything is structural** — only requires that a "model" has `findMany` + `count`
   with the standard call shape.
3. **Types degrade gracefully, never lie** — `select`/`include` narrowing is implemented
   by our own structural projection engine; for 100% Prisma-native inference use the
   passthrough `prisma.user.findMany(qb.buildArgs())`.
4. **Dialects are a capability registry** — `mode: 'insensitive'` is only emitted for
   PostgreSQL/CockroachDB/MongoDB (it throws on MySQL/SQLite/SQL Server). New/future
   databases need one `registerDialect()` call, no core changes.

## Dialect configuration

```ts
import { configureQueryBuilder } from 'query-builder-prisma';

configureQueryBuilder({ dialect: 'postgres' });           // global default
new QueryBuilder(prisma.user, { dialect: 'mysql' });      // per-builder override (recommended)
```

The global config state is shared through `globalThis` under a registered symbol, so
bundler graphs that load this package as both ESM and CJS still see ONE config.
The per-builder option stays the recommended path; unknown dialect names resolve
to `'universal'` (reported name included — the name never lies about the applied
capabilities).

## Behavior contracts

Semantics you can build on (the tests pin these):

- **Precedence** — explicit methods always win over `custom()` args, regardless of
  call order: `.select(X)` beats `custom({ select: Y })`;
  `.paginate(...)`/`.cursorPaginate(...)` beat `custom({ take })`;
  `.sortBy()`/`.orderBy()` beat `custom({ orderBy })`.
- **`where` assembly** — conditions from `.search/.filter/.range/.where` are
  AND-ed, a seeded `initialArgs.where` is AND-ed in front of them, and
  `.custom({ where })` is AND-ed with the seed and previous custom `where`s —
  it never replaces them.
- **`custom()` strips `undefined`** — at any depth, so
  `custom({ distinct: undefined })` cannot overwrite an earlier value. Keys
  named `__proto__`, `constructor` or `prototype` are refused (never written)
  in `custom()`, `filter()` and dot-path expansion.
- **Sorting** — `.sortBy()` is single-key sugar and expands dot paths like
  `.range()` (`'avatar.size'` → `{ avatar: { size: 'desc' } }`); `.orderBy()`
  takes the full Prisma shape verbatim (arrays for multi-key, nested relation
  orders). The latest of the two calls wins.
- **Cursor beats offset** — when both `.paginate()` and `.cursorPaginate()` are
  configured, cursor mode wins. `executeWithCursor()` always returns rows in the
  configured sort order, regardless of `direction`.
- **`executeWithMeta()` is offset-mode only** — it throws if `.cursorPaginate()`
  was configured (offset meta cannot describe a seek query); use
  `.executeWithCursor()` in cursor mode.
- **Cursor serialization** — `cursorPaginate({ cursor })` accepts a string,
  number or `Date`; `Date` values (and `Date` cursor fields) serialize to
  ISO-8601, so cursors are round-trippable and locale/TZ-independent.
- **Cursor flags are optimistic by default** — `hasNextPage`/`hasPrevPage` come
  from a one-row over-fetch and can rarely claim a page exists that turns out
  empty. `cursorPaginate({ strict: true })` spends one extra 1-row probe query
  to make both flags exact.
- **Cursor projection guard** — `executeWithCursor()` throws when a `.select()`
  projection drops `cursorField` (cursors would be built from `undefined`).
- **Clamping** — `limit` is clamped silently to `[1, 1000]`; pages below 1
  become page 1; computed `skip` is capped at `100_000` (deep access → cursor
  pagination). With `new QueryBuilder(delegate, { strictNumbers: true })` all of
  these throw instead of clamping.
- **`includeTotal`** — `executeWithMeta({ includeTotal: false })` skips the
  `COUNT` query; `meta` then carries `total: null` / `totalPage: null`.
- **Defaults** — `executeWithMeta()` without pagination defaults to page 1,
  limit 10 so `meta` always describes the returned data.
- **`.first()`** — forces `take: 1` and drops `skip`/`cursor`: it returns the
  first row of the whole result set, not of a configured page.
- **`search()`** — pass scalar string fields only (relation keys compile but
  throw at Prisma runtime); empty or whitespace-only `searchText` adds no
  condition; each `OR` arm gets its own match object.
- **`range()` reaches to-one paths only** — dot paths expand for to-one
  relations and nested objects; filtering a to-many relation needs
  `.custom({ where: { posts: { some: { ... } } } })`.
- **`_count` is typed wide** — `include({ _count: true })` widens the result
  type with `_count: Record<string, number>` (present, correct keys are unknown
  statically); the `prisma.user.findMany(qb.buildArgs())` passthrough recovers
  the exact per-relation shape.
- **`cursorField`** — must be unique and sequentially ordered (pair it with a
  matching `.sortBy()`); duplicates paginate wrong silently.
- **One builder per query** — instances are cheap; never share one across
  concurrent requests. Framework recipes: [docs/framework-recipes.md](./docs/framework-recipes.md).
- **Dialect config** — global config state is shared via `globalThis`, so ESM+CJS
  dual loading sees one config; the per-builder `dialect` option remains the
  recommended path, and unknown names resolve to `'universal'` (name included).

The former HIGH-severity footguns (seed-`where` replacement, `executeWithMeta()`
under cursor mode, nested-include type narrowing) are fixed and
regression-tested. Remaining limitations are documented below.

## Known limitations

Open and documented rather than hidden — none produces a silently wrong result:

- **Plain `.execute()` after `.cursorPaginate()`** returns raw seek-order rows
  including the one-row over-fetch — use `.executeWithCursor()` for trimmed,
  sort-ordered pages (kept as raw-passthrough semantics by design; the
  `buildArgs()` passthrough is always available).

## Development

```bash
npm run verify   # lint + typecheck + test + build
npm test         # unit tests (fake delegates, zero Prisma required)
```

- `src/core` — builder, condition assembly, pagination math
- `src/dialects` — capability registry, per-DB capabilities, auto-detect hook
- `src/types` — structural delegate contracts + projection type engine
- `test/types` — compile-time projection tests (run by `npm run typecheck`)
- `builder-old/` — the original prototype this package was extracted from (reference only)

Agent tooling (review agents, official Prisma skills, MCP servers) is documented
in [CONTRIBUTING.md](./CONTRIBUTING.md) and [AGENTS.md](./AGENTS.md).

Docs: [ARCHITECTURE.md](./ARCHITECTURE.md) (design + boundaries),
[AGENTS.md](./AGENTS.md) (agent/contributor rules),
[CONTRIBUTING.md](./CONTRIBUTING.md) (how to contribute),
[framework-recipes](./docs/framework-recipes.md) (Next.js / NestJS wiring).

> **Note:** published on npm as `query-builder-prisma`.
