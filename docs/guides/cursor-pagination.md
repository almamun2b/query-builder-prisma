# Cursor pagination

Cursor ("seek") pagination fetches the rows *after* (or before) a reference
row instead of skipping a computed offset. It stays fast on deep pages,
doesn't skip or duplicate rows when data shifts between requests, and is the
right model for infinite scroll, feeds, chats and any "load more" UI.

```ts
import { QueryBuilder } from 'query-builder-prisma';

const { meta, data } = await new QueryBuilder(prisma.user)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' }) // stable sort order
  .cursorPaginate({ cursorField: 'id', limit: 20 })
  .executeWithCursor();

// meta: {
//   limit: 20,
//   nextCursor: 'u42',   // opaque — pass back to get the next page
//   prevCursor: null,
//   hasNextPage: true,
//   hasPrevPage: false,
// }
```

## `.cursorPaginate()`

```ts
cursorPaginate(params: {
  cursor?: string | number | Date | undefined;
  limit?: number;
  direction?: CursorDirection;                  // 'forward' (default) | 'backward'
  cursorField?: OrderKeyOf<D> | (string & {});  // default 'id'
  strict?: boolean;                             // default false
}): this
```

| Parameter     | Meaning                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `cursor`      | Value of `cursorField` from the edge row of the previous page. Omit it for the first page.                           |
| `limit`       | Page size, clamped like [offset pagination](./pagination.md#clamping-and-limits). Default 10.                        |
| `direction`   | `'forward'` walks toward later rows, `'backward'` toward earlier ones. Output order is unaffected (see below).        |
| `cursorField` | The unique, sequential column to seek on. Default `'id'`. Pair it with a matching sort.                              |
| `strict`      | Spend one extra 1-row probe query to make `hasNextPage`/`hasPrevPage` exact (see [Strict mode](#strict-mode)).        |

Cursor mode **wins over offset mode** when both `.paginate()` and
`.cursorPaginate()` are configured.

## `.executeWithCursor()`

```ts
executeWithCursor(): Promise<{ meta: CursorMeta; data: FindResultOf<D, TArgs> }>
```

Runs the seek query and trims the over-fetch into a clean page:

- **Rows are always returned in the configured sort order**, regardless of
  `direction` — a backward page is re-reversed so the UI can render it
  without special-casing.
- `meta.nextCursor` / `meta.prevCursor` are `string | null` and opaque: pass
  them back as `cursor` for the following page. Call it with no cursor to get
  the first page.
- `hasNextPage` / `hasPrevPage` are derived from a one-row over-fetch
  (`take: limit + 1`) — see [Strict mode](#strict-mode) for the exact variant.
- Calling it without any `.cursorPaginate()` configuration is fine — it
  paginates with defaults (first page, limit 10, `id`, forward).

## Walking pages

```ts
// Page 1
const page1 = await feed.executeWithCursor();

// Next page — hand meta.nextCursor back to the client, receive it again
const page2 = await new QueryBuilder(prisma.post)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ cursor: page1.meta.nextCursor!, limit: 20 })
  .executeWithCursor();

// Previous page — same cursor, other direction
const prev = await new QueryBuilder(prisma.post)
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ cursor: page2.meta.prevCursor!, limit: 20, direction: 'backward' })
  .executeWithCursor();
// prev.data is in the same 'desc' order as page2 — ready to render above it
```

## Choosing `cursorField`

- Must be **unique** and **sequentially ordered** — a primary key (`id`) or a
  strictly increasing timestamp. Duplicates paginate wrong **silently**.
- Pair it with a matching `.sortBy()`/`.orderBy()` on the same field so the
  seek position and the sort agree.
- Timestamps work as cursors: `Date` values — and rows whose cursor field is a
  `Date` — serialize to **ISO-8601** in the returned cursors, so cursors are
  round-trippable and locale/timezone-independent. The serialized string is
  accepted back as `cursor`.

```ts
.cursorPaginate({ cursorField: 'createdAt', cursor: '2026-10-29T10:00:00.000Z' })
```

## Strict mode

By default the edge flags are **optimistic**: `hasNextPage`/`hasPrevPage` come
from the one-row over-fetch on the walking direction, and the opposite edge is
approximated. In rare cases a flag can claim a page exists that turns out to
be empty. With `strict: true` the builder spends **one extra 1-row probe
query** to make the flags exact:

```ts
.cursorPaginate({ cursor, limit: 20, strict: true })
```

The probe mirrors the main query's `where`/`orderBy`, so it stays correct
under filters. Use it when the UI must never show a dead "next" button;
skip it when an occasional empty fetch is acceptable and you want the minimum
query count.

## Guards

- **Projection guard.** `executeWithCursor()` throws when a `.select()`
  projection drops `cursorField` — page cursors would be built from
  `undefined`. Keep the cursor field in your projection or remove it:

  ```ts
  // throws: projection drops cursorField "id"
  new QueryBuilder(prisma.user)
    .select({ email: true })
    .cursorPaginate({ limit: 10 })
    .executeWithCursor();
  ```

- **Plain `.execute()` after `.cursorPaginate()`** returns raw seek-order rows
  *including* the one-row over-fetch — that is the documented passthrough
  behavior for `buildArgs()`-style use. Always use `.executeWithCursor()` for
  trimmed, sort-ordered pages. See
  [Known limitations](../../README.md#known-limitations).

## Related

- [Offset pagination](./pagination.md) — numbered pages + totals
- [Sorting](./sorting.md) — stable sorts for seek queries
- [QueryBuilder API — cursorPaginate](../api/query-builder.md#cursorpaginate)
