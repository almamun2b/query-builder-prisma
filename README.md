# @mamun/prisma-query-builder

> Zero-coupling, fluent, fully type-safe query builder for any Prisma model delegate.
> **Status: v0.1.0 — scaffold complete, core API working. See [PLAN.md](./PLAN.md).**

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

## Design rules (enforced in review, per [PLAN.md](./PLAN.md) §2)

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
import { configureQueryBuilder } from '@mamun/prisma-query-builder';

configureQueryBuilder({ dialect: 'postgres' });           // global default
new QueryBuilder(prisma.user, { dialect: 'mysql' });      // per-builder override
```

## Development

```bash
npm run verify   # lint + typecheck + test + build
npm test         # 42 unit tests (fake delegates, zero Prisma required)
```

- `src/core` — builder, condition assembly, pagination math
- `src/dialects` — capability registry, per-DB capabilities, auto-detect stub
- `src/types` — structural delegate contracts + projection type engine
- `test/types` — compile-time projection tests (run by `npm run typecheck`)
- `builder/` — the original prototype this package was extracted from (reference only)

> **Note:** the npm scope `@mamun/` is a placeholder — finalize before first publish (PLAN.md M4).
