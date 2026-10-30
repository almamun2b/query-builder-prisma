# query-builder-prisma

[![npm version](https://img.shields.io/npm/v/query-builder-prisma.svg)](https://www.npmjs.com/package/query-builder-prisma)
[![CI](https://github.com/almamun2b/query-builder-prisma/actions/workflows/ci.yml/badge.svg)](https://github.com/almamun2b/query-builder-prisma/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/query-builder-prisma.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/query-builder-prisma.svg)](https://www.npmjs.com/package/query-builder-prisma)

> Zero-coupling, fluent, fully type-safe query builder for any Prisma model
> delegate. Works with **every Prisma version — 5, 6, 7, 8 and future majors by
> design** — and every database Prisma supports.

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .search({ searchText: q, fields: ['email', 'username'] }) // dialect-aware
  .filter({ role, status }) // undefined values stripped
  .range({ createdAt: { from, to }, 'avatar.size': { from: min } })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 1, limit: 20 }) // or .cursorPaginate({...})
  .select({ id: true, email: true }) // output type narrows structurally
  .executeWithMeta();
// meta: { page: 1, limit: 20, total: 142, totalPage: 8 }
```

## Why

An npm package that imports Prisma types breaks on Prisma's next major — import
paths changed in v7, the type utilities move in v8, the engine was rewritten.
This package speaks only Prisma's stable public contract, the **model-delegate
call shape**:

```
model.findMany({ where, orderBy, skip, take, select, include, cursor, distinct })
model.count({ where })
```

It imports **nothing** from Prisma — no runtime imports, no type imports, no
peer dependencies. All types are derived structurally from the delegate you
pass in, so a Prisma upgrade can never break it. The test suite runs with zero
Prisma installed; that is the standing proof.

## Install

```bash
npm install query-builder-prisma
```

Published on npm as [`query-builder-prisma`](https://www.npmjs.com/package/query-builder-prisma).

Node ≥ 18; TypeScript ≥ 5 for inference (plain JS works). Dual ESM + CJS; zero
runtime dependencies.

## Documentation

|                                                  |                                                                                     |
| ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| [Getting started](./docs/getting-started.md)     | install, first query, imports                                                       |
| [Guides](./docs/readme.md#guides)                | filtering, sorting, both pagination modes, projections, dialects, advanced patterns |
| [API reference](./docs/api/query-builder.md)     | every method, type and function                                                     |
| [Use cases](./docs/examples/use-cases.md)        | end-to-end scenarios                                                                |
| [Framework recipes](./docs/framework-recipes.md) | Next.js, NestJS, Express, edge runtimes                                             |

## Features

- **Fluent chain** — `search`, `filter`, `range`, `where`, `sortBy`/`orderBy`,
  `paginate`/`cursorPaginate`, `select`/`include`, `custom`, folded into one
  `findMany` call.
- **Offset pagination with metadata** — `executeWithMeta()` returns
  `page`/`limit`/`total`/`totalPage`, with `COUNT` + `findMany` in parallel and
  an opt-in fast path (`includeTotal: false`) that skips the `COUNT`.
- **Cursor (seek) pagination** — stable deep pages for feeds and infinite
  scroll, forward/backward walking, ISO-8601-safe `Date` cursors, exact flags
  via `strict: true`.
- **Structural type projection** — `.select()`/`.include()` narrow result types
  like Prisma's own overloads, nested includes included, without Prisma types.
- **Dialect capability registry** — `mode: 'insensitive'` only where Prisma
  accepts it; new databases are one `registerDialect()` call.
- **Hardened by default** — `undefined` stripping at any depth, prototype-key
  refusal, clamped (or thrown) pagination numbers, a seed `where` that cannot
  be replaced.

### Offsetting and counting

```ts
const { meta, data } = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .paginate({ page: 2, limit: 20 })
  .executeWithMeta(); // meta: { page: 2, limit: 20, total, totalPage }

// Skip the COUNT query on large tables:
await qb.executeWithMeta({ includeTotal: false }); // total: null, totalPage: null
```

### Cursor pagination

```ts
const page = await new QueryBuilder(prisma.post)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ cursor: prev?.nextCursor, cursorField: 'createdAt', limit: 10 })
  .executeWithCursor();
// meta: { limit, nextCursor, prevCursor, hasNextPage, hasPrevPage }
// rows always in configured sort order, whatever the walking direction
```

### Type-safe projections

```ts
const users = await new QueryBuilder(prisma.user)
  .select({ id: true, posts: { select: { title: true } } })
  .execute();
// users: { id: string; posts: { title: string }[] }[] — no Prisma types involved

// 100% Prisma-native inference whenever you want it:
await prisma.user.findMany(qb.buildArgs());
```

### Dialects

```ts
import { configQueryBuilder } from 'query-builder-prisma';

configQueryBuilder({ dialect: 'postgresql' }); // global default
new QueryBuilder(prisma.user, { dialect: 'mysql' }); // per-builder override (recommended)
```

`search()` emits `mode: 'insensitive'` only on PostgreSQL / CockroachDB /
MongoDB (it throws on MySQL, SQLite, SQL Server); elsewhere the database's
collation or Prisma's limits apply. Unknown dialect names resolve to
`'universal'` — arguments valid on every database.

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

## FAQ

**Does this need Prisma installed?**
The package never imports Prisma, but of course you query _through_ your
Prisma delegates — you pass them in. Any object with the `findMany` + `count`
call shape works, which is also how the test suite proves the decoupling.

**Which Prisma versions are supported?**
Every version whose model delegates keep the standard call shape — 5, 6, 7, 8
today, future majors by design. There is nothing to update on a Prisma
upgrade.

**Can I share one builder across requests?**
No — one builder per query. Instances are cheap; a shared instance mixes
conditions between concurrent requests. See
[Advanced patterns](./docs/guides/advanced.md#one-builder-per-query) and the
[framework recipes](./docs/framework-recipes.md).

**What if a type isn't narrow enough?**
The engine degrades wider, never wrong (today only `_count`). For exact
Prisma-native inference on any query, use the passthrough:
`prisma.user.findMany(qb.buildArgs())`.

**How do I add a database Prisma adds later?**
One `registerDialect(name, capabilities)` call — no core changes. See
[Dialects](./docs/guides/dialects.md).

## Development

```bash
npm run verify   # lint + typecheck + test + build (the bar for every change)
npm test         # unit tests — fake delegates, zero Prisma required
```

- `src/core` — builder, condition assembly, pagination math
- `src/dialects` — capability registry, per-DB capabilities, auto-detect hook
- `src/types` — structural delegate contracts + projection type engine
- `test/types` — compile-time projection tests (run by `npm run typecheck`)

### Releases

Releases are fully automatic — there is no manual publish step. Conventional
Commits on `main` drive the version ([semantic-release](https://semantic-release.org),
see `.github/workflows/release.yml`):

| Commits since the last `v*` tag      | Version | Example       |
| ------------------------------------ | ------- | ------------- |
| `fix:`                               | patch   | 0.2.0 → 0.2.1 |
| `feat:`                              | minor   | 0.2.0 → 0.3.0 |
| `feat!:` / `BREAKING CHANGE:` footer | major   | 0.2.0 → 1.0.0 |
| `chore:` / `docs:` / `ci:` / `test:` | none    | no release    |

A release publishes the new version to npm with provenance (the full
verify pipeline runs first; `package.json` on `main` is not bumped — the `v*`
tag is the version source of truth), pushes the `v*` tag, and creates the GitHub
Release with generated notes. [`CHANGELOG.md`](./CHANGELOG.md) stays
hand-maintained; the auto-generated notes live on
[GitHub Releases](https://github.com/almamun2b/query-builder-prisma/releases).
A failed release can be re-run from the Actions tab (`workflow_dispatch`).

### Links

- [ARCHITECTURE.md](./ARCHITECTURE.md) — design, boundaries, invariants
- [docs/readme.md](./docs/readme.md) — full documentation hub
- [CONTRIBUTING.md](./CONTRIBUTING.md) — how to contribute
- [SECURITY.md](./SECURITY.md) — vulnerability reporting
- [CHANGELOG.md](./CHANGELOG.md) — release history

> Published on npm as [`query-builder-prisma`](https://www.npmjs.com/package/query-builder-prisma).
> MIT licensed.
