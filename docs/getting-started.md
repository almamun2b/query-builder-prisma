# Getting started

`query-builder-prisma` wraps any Prisma model delegate in a fluent, type-safe
builder for search, filtering, sorting, pagination and projections. It has
**zero Prisma imports** — all types are derived structurally from the delegate
you pass in — so it works with every Prisma version that keeps the standard
model-delegate call shape (5, 6, 7, 8 and future majors by design).

## Requirements

- Node.js ≥ 18
- TypeScript ≥ 5 (for the type inference; plain JavaScript works too, you just
  lose the inference)
- A Prisma client — any version — or any object with the delegate call shape

There are **no peer dependencies**: the package never imports Prisma at runtime
or at type level, and ships dual ESM + CJS from a single entry.

## Install

```bash
npm install query-builder-prisma
```

Available on npm: [`query-builder-prisma`](https://www.npmjs.com/package/query-builder-prisma).

```bash
yarn add query-builder-prisma
```

```bash
pnpm add query-builder-prisma
```

## Your first query

Pass a model delegate to the constructor, chain the pieces you need, and call
one of the execute methods:

```ts
import { QueryBuilder } from 'query-builder-prisma';
import { prisma } from './lib/prisma';

const { meta, data } = await new QueryBuilder(prisma.user)
  .search({ searchText: 'ada', fields: ['email', 'username'] })
  .filter({ role: 'ADMIN', status: 'ACTIVE' })
  .range({ createdAt: { from: new Date('2026-01-01') } })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 20 })
  .select({ id: true, email: true })
  .executeWithMeta();

// meta: { page: 1, limit: 20, total: 142, totalPage: 8 }
// data: { id: string; email: string }[] — narrowed by .select()
```

The result type of `execute()`/`executeWithMeta()` follows your `.select()` /
`.include()` calls exactly, mirroring Prisma's own projection behavior with a
structural type engine — without importing a single Prisma type.

## How it executes

Nothing touches the database until you call an execute method
(`execute`, `first`, `firstOrThrow`, `count`, `executeWithMeta`,
`executeWithCursor`). The builder folds its state into a `findMany` args object
and calls the delegate:

- `execute()` and friends call `delegate.findMany(args)`
- `count()` and `executeWithMeta()` also call `delegate.count({ where })`

The only requirement on the "delegate" is that call shape — which every Prisma
model delegate satisfies on every version. That is also why the test suite can
run with no Prisma installed at all: hand-written fakes prove the contract.

## Import forms

```ts
// ESM
import { QueryBuilder, configQueryBuilder } from 'query-builder-prisma';
```

```js
// CJS
const { QueryBuilder, configQueryBuilder } = require('query-builder-prisma');
```

```ts
// Deno (via the npm specifier)
import { QueryBuilder } from 'npm:query-builder-prisma';
```

Edge runtimes (Vercel Edge, Cloudflare Workers, Bun, Deno) work without extra
setup — the package has zero Node-API usage. See
[Framework recipes](./framework-recipes.md) for framework-specific wiring.

## Recommended setup

1. **Configure your dialect once** (or per builder) so dialect-aware features
   like `search()` emit valid arguments for your database:

   ```ts
   import { configQueryBuilder } from 'query-builder-prisma';

   configQueryBuilder({ dialect: 'postgresql' });
   // or per builder (recommended):
   new QueryBuilder(prisma.user, { dialect: 'postgresql' });
   ```

   See [Dialects](./guides/dialects.md).

2. **Create one builder per query.** Instances are cheap; a shared instance
   mixes conditions between concurrent requests. See
   [Advanced patterns](./guides/advanced.md#one-builder-per-query).

## Next steps

- [Filtering and search](./guides/filtering.md)
- [Offset pagination](./guides/pagination.md) or
  [Cursor pagination](./guides/cursor-pagination.md)
- [Projections (select/include)](./guides/projections.md)
- Full [API reference](./api/query-builder.md)
