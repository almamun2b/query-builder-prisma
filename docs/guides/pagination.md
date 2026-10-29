# Offset pagination

Offset ("skip/take") pagination is the classic page-number model: the client
asks for *page N with limit L*, the builder computes `skip`/`take`, and
`executeWithMeta()` returns the rows plus `page`/`limit`/`total`/`totalPage`
metadata. Use it for admin tables, dashboards and anything that needs numbered
pages and a total count. For very large or fast-moving tables, prefer
[cursor pagination](./cursor-pagination.md).

```ts
import { QueryBuilder } from 'query-builder-prisma';

const { meta, data } = await new QueryBuilder(prisma.user)
  .filter({ role: 'ADMIN' })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .paginate({ page: 2, limit: 20 })
  .executeWithMeta();

// meta: { page: 2, limit: 20, total: 142, totalPage: 8 }
```

## `.paginate()`

```ts
paginate(params: { page?: number; limit?: number }): this
```

Configures `skip`/`take` from a 1-based page number and page size. Both values
are optional and default to page `1`, limit `10`. Input is clamped (see
[Clamping and limits](#clamping-and-limits)).

If you only need the rows — not the metadata — call `.execute()` instead of
`executeWithMeta()`; a configured `.paginate()` still applies.

## `.executeWithMeta()`

```ts
executeWithMeta<O extends { includeTotal?: boolean } = { includeTotal?: boolean }>(
  opts?: O,
): Promise<{ meta: MetaOf<O>; data: FindResultOf<D, TArgs> }>
```

Runs the query and returns rows + offset metadata:

- `count()` and `findMany()` run **in parallel**.
- With **no pagination configured**, it defaults to page 1, limit 10 so `meta`
  always describes the data actually returned.
- With `opts.includeTotal === false` the `COUNT` query is **skipped entirely**;
  `meta` then carries `total: null` / `totalPage: null` and the return type is
  `PaginationMetaNoTotal`. Useful for large tables where a count is too
  expensive and the UI doesn't show totals.
- **Throws when cursor pagination is configured** — offset meta cannot describe
  a seek query. If you called `.cursorPaginate()`, use
  [`.executeWithCursor()`](./cursor-pagination.md) instead.

```ts
// Skip the COUNT query — meta.total is null, typed as PaginationMetaNoTotal
const { meta, data } = await qb.executeWithMeta({ includeTotal: false });
// meta: { page: 1, limit: 20, total: null, totalPage: null }
```

## `.count()`

```ts
count(): Promise<number>
```

Counts rows matching the current filters. Pagination and projections are
ignored — only the assembled `where` is sent:

```ts
const total = await new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .count(); // ignores .paginate()/.select()
```

## Clamping and limits

Out-of-range numbers cannot reach the database unbounded. By default the
builder clamps silently:

| Input                                   | Behavior                                  |
| --------------------------------------- | ----------------------------------------- |
| `limit` outside `[1, 1000]`              | clamped into `[1, 1000]` (non-finite → 10) |
| page below 1 (or non-finite)             | becomes page 1                             |
| computed `skip` beyond `100_000`         | capped at `100_000` — deep access should use cursor pagination |

With `strictNumbers: true` on the constructor, all of the above **throw
instead** — including a computed skip beyond the cap, which fails before the
`COUNT` goes out:

```ts
const qb = new QueryBuilder(prisma.user, { strictNumbers: true });
qb.paginate({ page: 0 });       // throws: page must be >= 1
qb.paginate({ limit: 5000 });   // throws: limit outside [1, 1000]
qb.paginate({ page: 1_000_000, limit: 100 }); // throws: skip beyond cap
```

Use `strictNumbers` on internal/admin surfaces where bad numbers indicate a
bug; keep clamping on public endpoints where users send arbitrary values.

## Related

- [Cursor pagination](./cursor-pagination.md) — for deep pages and live feeds
- [Projections](./projections.md) — narrow `data` with `.select()`
- [QueryBuilder API — executeWithMeta](../api/query-builder.md#executewithmeta)
