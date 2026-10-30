# Sorting

Two methods set `orderBy`. `.sortBy()` is single-key sugar fed by free-form
input (sort dropdowns, query params); `.orderBy()` takes the full Prisma shape.
**The latest of the two calls wins**, so a default set in one place can be
overridden later in the chain.

## `.sortBy()` — single key + direction

```ts
sortBy(params: { sortBy?: OrderKeyOf<D> | (string & {}); sortOrder?: SortOrder }): this
```

```ts
.sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
// orderBy: { createdAt: 'desc' }
```

Behavior:

- `sortOrder` defaults to `'desc'` when omitted.
- **No-op when `sortBy` is not provided** — safe to forward optional input:
  `.sortBy({ sortBy: params.get('sort') ?? undefined })`.
- **Dot paths expand** like `.range()`: `'avatar.size'` →
  `{ avatar: { size: 'desc' } }`.
- The key is typed as `OrderKeyOf<D>` (every key Prisma allows in `orderBy`);
  `(string & {})` keeps autocompletion while still accepting dynamic strings.

## `.orderBy()` — the full Prisma shape

```ts
orderBy(order: OrderByOf<D>): this
```

For multi-key sorts and nested relation orders, passed through verbatim:

```ts
.orderBy([{ role: 'asc' }, { createdAt: 'desc' }])       // multi-key
.orderBy({ posts: { _count: 'desc' } })                  // relation order
```

## Precedence

Both methods write the same internal `orderBy` slot — the last call wins — and
either beats an `orderBy` coming in through `.custom()`:

```ts
new QueryBuilder(prisma.user).custom({ orderBy: { id: 'asc' } }).sortBy({ sortBy: 'createdAt' }); // wins → orderBy: { createdAt: 'desc' }
```

Explicit builder methods always beat `.custom()` args, regardless of call
order — see the [Behavior contracts](../../README.md#behavior-contracts).

## Sorting for cursor pagination

Cursor ("seek") pagination walks the result set in the configured sort order.
Pair `cursorPaginate`'s `cursorField` with a matching `.sortBy()` /
`.orderBy()` so pages are stable and cursors land where you expect:

```ts
new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ cursorField: 'createdAt', limit: 20 })
  .executeWithCursor();
```

`cursorField` must be unique and sequentially ordered (a primary key or a
strictly increasing timestamp) — duplicates paginate wrong silently. See
[Cursor pagination](./cursor-pagination.md).

## Related

- [Filtering and search](./filtering.md)
- [Cursor pagination](./cursor-pagination.md)
- [QueryBuilder API — sortBy](../api/query-builder.md#sortby) /
  [orderBy](../api/query-builder.md#orderby)
