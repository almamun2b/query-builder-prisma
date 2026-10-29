# @almamun2b/prisma-query-builder

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
import { configureQueryBuilder } from '@almamun2b/prisma-query-builder';

configureQueryBuilder({ dialect: 'postgres' });           // global default
new QueryBuilder(prisma.user, { dialect: 'mysql' });      // per-builder override
```

## Behavior contracts

Semantics you can build on (the tests pin these):

- **Precedence** — explicit methods always win over `custom()` args, regardless of
  call order: `.select(X)` beats `custom({ select: Y })`;
  `.paginate(...)`/`.cursorPaginate(...)` beat `custom({ take })`.
- **`where` assembly** — conditions from `.search/.filter/.range/.where` are
  AND-ed, a seeded `initialArgs.where` is AND-ed in front of them, and
  `.custom({ where })` is AND-ed with the seed and previous custom `where`s —
  it never replaces them.
- **Cursor beats offset** — when both `.paginate()` and `.cursorPaginate()` are
  configured, cursor mode wins. `executeWithCursor()` always returns rows in the
  configured sort order, regardless of `direction`.
- **`executeWithMeta()` is offset-mode only** — it throws if `.cursorPaginate()`
  was configured (offset meta cannot describe a seek query); use
  `.executeWithCursor()` in cursor mode.
- **Cursor flags are optimistic** — `hasNextPage`/`hasPrevPage` are based on a
  one-row over-fetch and can rarely claim a page exists that turns out empty.
- **Clamping** — `limit` is clamped silently to `[1, 1000]`; pages below 1 become
  page 1.
- **Defaults** — `executeWithMeta()` without pagination defaults to page 1,
  limit 10 so `meta` always describes the returned data.
- **`.first()`** — forces `take: 1` and drops `skip`/`cursor`: it returns the
  first row of the whole result set, not of a configured page.
- **`search()` fields** — pass scalar string fields only; relation keys compile
  but throw at Prisma runtime.
- **`cursorField`** — must be unique and sequentially ordered (pair it with a
  matching `.sortBy()`); duplicates paginate wrong silently.
- **One builder per query** — instances are cheap; never share one across
  concurrent requests.
- **Dialect config** — the per-builder `dialect` option is the reliable path;
  global `configureQueryBuilder()` can be invisible when a bundler loads this
  package as both ESM and CJS.

The former HIGH-severity footguns (seed-`where` replacement, `executeWithMeta()`
under cursor mode, nested-include type narrowing) are fixed and
regression-tested. Remaining limitations are documented below.

## Known limitations

Open and documented rather than hidden — none produces a silently wrong result:

- **Date cursors are lossy** — a `Date` `cursorField` is stringified with
  `String()`; the cursor is locale/TZ-dependent and not round-trippable. Use a
  number or string cursor field for now.
- **`.select()` must keep the `cursorField`** — a projection without it yields a
  literal `"undefined"` cursor; the next seek would target a nonexistent row.
- **`sortBy()` takes top-level fields only** — dot paths are not expanded
  (`.range()` does expand them); relation-field sorts need `.custom({ orderBy })`.
- **Plain `.execute()` after `.cursorPaginate()`** returns raw seek-order rows
  including the one-row over-fetch — use `.executeWithCursor()` for trimmed,
  sort-ordered pages.
- **`_count` is missing from projected types** — `include({ _count: true })`
  works at runtime but the type omits it; the
  `prisma.user.findMany(qb.buildArgs())` passthrough recovers exact inference.
- **Offset `skip` is uncapped** — `page × limit` is sent as-is; prefer cursor
  pagination for deep pages.

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
[CONTRIBUTING.md](./CONTRIBUTING.md) (how to contribute).

> **Note:** the npm scope `@almamun2b/` is live on npm.
