# Documentation

[`query-builder-prisma`](https://www.npmjs.com/package/query-builder-prisma) — a
zero-coupling, fluent, fully type-safe query builder
for any Prisma model delegate. It imports nothing from Prisma: every option and
result type is derived structurally from the delegate you pass in, so a Prisma
upgrade can never break your build.

## Start here

| Document                                   | What it covers                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| [Getting started](./getting-started.md)     | Install, requirements, first query, ESM/CJS/Deno imports                  |
| [README](../README.md)                      | Feature tour, behavior contracts, known limitations                       |

## Guides

Task-oriented, in the order you typically need them:

| Guide                                                | What it covers                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------- |
| [Filtering and search](./guides/filtering.md)         | `search`, `filter`, `range`, `where` — and how conditions AND-merge          |
| [Sorting](./guides/sorting.md)                        | `sortBy` vs `orderBy`, dot paths, precedence                                |
| [Offset pagination](./guides/pagination.md)           | `paginate` + `executeWithMeta`, clamping, `strictNumbers`, `includeTotal`    |
| [Cursor pagination](./guides/cursor-pagination.md)    | `cursorPaginate` + `executeWithCursor`, directions, strict mode, cursors     |
| [Projections (select/include)](./guides/projections.md)| Type narrowing without Prisma types, nested includes, the `_count` gap       |
| [Dialects](./guides/dialects.md)                      | Per-database capabilities, resolution order, custom dialects                 |
| [Advanced patterns](./guides/advanced.md)             | `custom()`, `initialArgs` seeding, safety hardening, concurrency rules       |

## API reference

| Reference                                  | What it covers                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| [QueryBuilder class](./api/query-builder.md)| Every method: signature, parameters, returns, throws, examples             |
| [Types](./api/types.md)                     | All exported types — options, meta, dialect, structural extractors         |
| [Functions](./api/functions.md)             | Dialect configuration functions, `DIALECT_CAPABILITIES`, `NoResultError`    |

## Examples

| Document                                    | What it covers                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------- |
| [Use cases](./examples/use-cases.md)         | End-to-end scenarios: admin tables, infinite scroll, soft delete, …        |
| [Framework recipes](./framework-recipes.md)  | Next.js, NestJS, Express, edge runtimes wiring                            |

## Reading paths

- **New to the package** — [Getting started](./getting-started.md) →
  [Filtering](./guides/filtering.md) → [Offset pagination](./guides/pagination.md)
  → skim the [QueryBuilder API](./api/query-builder.md).
- **Building a listing endpoint** — [Filtering](./guides/filtering.md) +
  [Sorting](./guides/sorting.md) + [Offset pagination](./guides/pagination.md),
  then the [admin-table use case](./examples/use-cases.md#1-paginated-admin-table-from-rest-query-params).
- **Large or fast-moving tables** — [Cursor pagination](./guides/cursor-pagination.md)
  → the [infinite-scroll use case](./examples/use-cases.md#2-infinite-scroll-feed-forward-cursor).
- **Wiring a framework** — [Framework recipes](./framework-recipes.md) and the
  concurrency rules in [Advanced patterns](./guides/advanced.md).

## Where normative behavior lives

Semantics you can build on are pinned as contracts in the README
([Behavior contracts](../README.md#behavior-contracts)); open gaps are listed
under [Known limitations](../README.md#known-limitations). Design and
architecture are documented in [ARCHITECTURE.md](../ARCHITECTURE.md); working
rules for contributors in [AGENTS.md](../AGENTS.md) and
[CONTRIBUTING.md](../CONTRIBUTING.md).
