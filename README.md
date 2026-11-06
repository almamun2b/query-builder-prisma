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
  refusal (a thrown error, never a silent drop), clamped (or thrown) pagination numbers, a seed `where` that cannot
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
  `.paginate(...)`/`.cursorPaginate(...)` beat `custom({ take })`, and offset
  pagination (`.paginate()`, `.executeWithMeta()`) never lets a raw
  `custom({ cursor })` seek on top of its `skip`/`take`;
  `.sortBy()`/`.orderBy()` beat `custom({ orderBy })`. Projections resolve to
  exactly one key: explicit `.select()` > explicit `.include()` > a `select`
  from `custom()`/`initialArgs` > an `include` from the same — so `.select()`
  on a builder seeded with an `include` sends only the `select` (and vice
  versa), never both.
- **`where` assembly** — conditions from `.search/.filter/.range/.where` are
  AND-ed, a seeded `initialArgs.where` is AND-ed in front of them, and
  `.custom({ where })` is AND-ed with the seed and previous custom `where`s —
  it never replaces them.
- **`custom()` strips `undefined`** — at any depth, so
  `custom({ distinct: undefined })` cannot overwrite an earlier value (the
  `initialArgs` seed is stripped the same way, and a `null` `where` is ignored). Keys
  named `__proto__`, `constructor` or `prototype` **throw** (`Refused key "…"`)
  in `custom()`, `initialArgs`, `filter()`, `where()` and dot-path expansion (`range`,
  `sortBy`) - they are never written and never silently dropped, because
  dropping a filter would widen the query. Empty input (`sortBy: ''`, empty
  `searchText`, `fields: []`) stays a documented no-op.
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
  number, bigint or `Date`; `Date` values (and `Date` cursor fields) serialize
  to ISO-8601, so cursors are round-trippable and locale/TZ-independent.
  `meta.nextCursor`/`prevCursor` are always **strings**, and Prisma rejects a
  string for an `Int`/`BigInt` cursor field - so pass
  `cursorType: 'number' | 'bigint' | 'date'` to convert a cursor read back from a
  query string. The default `'string'` passes the value through unchanged; an
  unconvertible cursor throws in `cursorPaginate()`, before any query is sent.
- **Cursor flags are optimistic by default** — `hasNextPage`/`hasPrevPage` come
  from a one-row over-fetch and can rarely claim a page exists that turns out
  empty. `cursorPaginate({ strict: true })` spends one extra 1-row probe query
  to make both flags exact.
- **Cursor projection guard** — `executeWithCursor()` throws when a `.select()`
  projection (or a `custom({ omit })`) drops `cursorField`, and when a returned
  edge row has a missing/`null` cursor value or an Invalid Date (the page
  cursor cannot be built) — never a cursor of `"undefined"`/`"null"`.
- **Clamping** — `limit` is clamped silently to `[1, 1000]`; pages below 1
  become page 1; a page whose computed `skip` exceeds `100_000` is served as an
  **empty page** (`take: 0`) with `meta.page` still the requested page — never as
  a different page (deep access → cursor pagination). With `new QueryBuilder(delegate, { strictNumbers: true })` all of
  these throw instead of clamping.
- **`includeTotal`** — `executeWithMeta({ includeTotal: false })` skips the
  `COUNT` query; `meta` then carries `total: null` / `totalPage: null`.
- **Defaults** — `executeWithMeta()` without pagination defaults to page 1,
  limit 10 so `meta` always describes the returned data. `executeWithCursor()`
  without `.cursorPaginate()` starts at the first page and uses the
  `.paginate()` limit when one was set (default 10). Neither execute method
  changes the builder: a later `execute()` or the other pagination mode behaves
  as if it had not run.
- **Strict cursor probe** — `strict: true` sends one extra 1-row query built from
  the main query (same `where`, `orderBy` and `distinct` from every source),
  fetching only the cursor field, in parallel with the main query.
- **Cursor mode owns `cursor`/`skip`/`take`** — raw `custom({ cursor, skip, take })`
  values are replaced, not merged, once `.cursorPaginate()` is configured.
- **`.first()`** — forces `take: 1` and drops `skip`/`cursor`: it returns the
  first row of the whole result set, not of a configured page.
- **`search()`** — pass scalar string fields only (relation keys compile but
  throw at Prisma runtime); empty or whitespace-only `searchText` adds no
  condition; each `OR` arm gets its own match object.
- **`range()` reaches to-one paths only** — dot paths expand for to-one
  relations and nested objects; filtering a to-many relation needs
  `.custom({ where: { posts: { some: { ... } } } })`.
- **Wide-but-never-wrong types** — `_count` (in `select` or `include`) widens the
  result type with `_count: Record<string, number>`, and a relation that the
  delegate's row type does not describe (Prisma's generic `findMany` resolves to
  the scalar-only row) is typed `unknown` instead of being dropped. A flag typed
  as a plain `boolean` makes its key optional. The
  `prisma.user.findMany(qb.buildArgs())` passthrough recovers Prisma's exact
  per-relation shape (verified against a generated Prisma 7 client).
- **`custom()` projections are tracked** — a literal `select`/`include` passed to
  `.custom()` narrows the result type, but an explicit `.select()`/`.include()`
  always wins, as at runtime. `initialArgs` projections and a `custom()` argument
  held in a wide variable are not tracked.
- **`cursorField`** — must be unique and sequentially ordered (pair it with a
  matching `.sortBy()`); duplicates paginate wrong silently.
- **One builder per query** — instances are cheap; never share one across
  concurrent requests. `.select()`, `.include()` and a `.custom()` call that
  carries a `select`/`include` change the result type, so they return a **new,
  independent builder** (the one you called them on is untouched - always use
  the returned value); `clone()` branches a base query explicitly. Every other
  chain method mutates and returns the same builder. Framework recipes: [docs/framework-recipes.md](./docs/framework-recipes.md).
- **Dialect config** — global config state is shared via `globalThis`, so ESM+CJS
  dual loading sees one config; the per-builder `dialect` option remains the
  recommended path, and unknown names resolve to `'universal'` (name included).

The former HIGH-severity footguns (seed-`where` replacement, `executeWithMeta()`
under cursor mode, nested-include type narrowing) are fixed and
regression-tested. Remaining limitations are documented below.

## Known limitations

Open and documented rather than hidden. Each says how it fails and what to do instead:

- **Plain `.execute()` after `.cursorPaginate()`** returns raw seek-order rows
  including the one-row over-fetch — use `.executeWithCursor()` for trimmed,
  sort-ordered pages (kept as raw-passthrough semantics by design; the
  `buildArgs()` passthrough is always available).
- **Strict cursor flags ignore the cursor row itself** — the `strict: true`
  probe looks for rows strictly before/after the cursor row, so walking
  backward from the dataset's last row reports `hasNextPage: false` although
  the cursor row follows that page (and forward from the first row reports
  `hasPrevPage: false`). The default optimistic flags say `true` in those two
  cases; at those edges treat them as authoritative.
- **Some projections are not reflected in the result type** — a `select`/`include`
  seeded through `initialArgs`, a `custom()` argument held in a wide variable
  (not a literal), and `custom({ omit | distinct })` still run, but the type
  stays the full row (it may claim fields the query did not return). Use
  `.select()`/`.include()`, or the `buildArgs()` passthrough, when the exact
  shape matters.
- **Wide types by design** — a relation the delegate's row type does not
  describe is `unknown`, and `_count` is `Record<string, number>`. They are
  correct but not precise; `prisma.user.findMany(qb.buildArgs())` gives
  Prisma's exact shape.
- **Dot paths reach to-one relations only** — `range()`/`sortBy()` paths into a
  to-many relation produce `{ posts: { field } }`, which Prisma rejects at
  runtime (loudly); use `.where({ posts: { some: { … } } })`.
- **No field allow-list** — `sortBy`, `cursorField` and `range` keys accept any
  string; validate user-supplied field names yourself (e.g. against a fixed
  list) before passing them in.
- **`count()` ignores `distinct`**, so `executeWithMeta()` totals can over-count
  when `distinct` is set through `custom()`.
- **Typing edges** — `sortBy` defaults to `desc` (opposite of SQL); with
  `exactOptionalPropertyTypes` the `paginate`/`sortBy`/`cursorPaginate`
  parameters do not accept an explicit `undefined`; a custom dialect name needs
  a cast to satisfy the `dialect` option's built-in union.

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
The engine degrades wider, never wrong (`_count`, relations the row type
does not describe). For exact
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

A release publishes the new version to npm with provenance via npm trusted
publishing (OIDC — no `NPM_TOKEN` secret; setup in
[CONTRIBUTING.md](./CONTRIBUTING.md#one-time-npm-setup-trusted-publishing-no-token));
the full verify pipeline runs first, and `package.json` on `main` is not bumped —
the `v*` tag is the version source of truth. The release pushes the `v*` tag and creates the GitHub
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
