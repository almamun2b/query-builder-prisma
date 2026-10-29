# `QueryBuilder`

The fluent builder. Constructed with a model delegate, chained to describe the
query, and executed with one of the terminal methods. All option and result
types are derived structurally from the delegate — nothing is imported from
Prisma.

```ts
import { QueryBuilder } from 'query-builder-prisma';

const result = await new QueryBuilder(prisma.user, { dialect: 'postgresql' })
  .search({ searchText: q, fields: ['email'] })
  .filter({ status })
  .sortBy({ sortBy: 'createdAt' })
  .paginate({ page: 1, limit: 20 })
  .select({ id: true, email: true })
  .executeWithMeta();
```

- **Type parameters:** `D` — the model delegate (e.g. `typeof prisma.user`);
  `TArgs` — the accumulated `findMany` args, threaded by `.select()`/`.include()`
  to narrow result types.
- **State:** one builder accumulates one query. Instances are cheap; never
  share one across concurrent requests (see
  [Advanced patterns](../guides/advanced.md#one-builder-per-query)).

Chain methods return `this` (or a re-typed builder for `select`/`include`) and
do no I/O. Terminal methods run the query.

## constructor

```ts
constructor(delegate: D, options?: QueryBuilderOptions<D>)
```

| Parameter  | Type                                            | Description                          |
| ---------- | ----------------------------------------------- | ------------------------------------ |
| `delegate` | `D`                                             | The model delegate, e.g. `prisma.user` |
| `options`  | [`QueryBuilderOptions<D>`](./types.md#querybuilderoptions) | `initialArgs`, `dialect`, `strictNumbers` |

```ts
new QueryBuilder(prisma.user, {
  initialArgs: { where: { deletedAt: null } }, // seed where, AND-ed in front
  dialect: 'postgresql',                       // per-builder dialect override
  strictNumbers: true,                         // throw on out-of-range numbers
});
```

---

## Chain methods

## `.search()`

```ts
search(params: { searchText?: string | undefined; fields: WhereKeyOf<D>[] }): this
```

Case-insensitive `contains` across the given string fields, OR-ed together.

| Parameter    | Type              | Description                        |
| ------------ | ----------------- | ---------------------------------- |
| `searchText` | `string \| undefined` | Text to search; empty/whitespace adds no condition |
| `fields`     | `WhereKeyOf<D>[]` | Scalar **string** fields to search |

- Dialect-aware: emits `mode: 'insensitive'` only on postgresql /
  cockroachdb / mongodb; elsewhere relies on collation (see
  [Dialects](../guides/dialects.md)).
- Relation keys compile but throw at Prisma runtime — pass scalar strings only.

```ts
.search({ searchText: 'ada', fields: ['email', 'username'] })
```

## `.filter()`

```ts
filter(filters: FilterInput<D>): this
```

Adds a partial Prisma `where`; `undefined` values are stripped, so optional
query params can be forwarded directly. Dangerous keys
(`__proto__`/`constructor`/`prototype`) are refused.

```ts
.filter({ role: dto.role, status: dto.status, deletedAt: undefined })
```

## `.range()`

```ts
range(ranges: Record<string, RangeInput>): this
```

Adds `gte`/`lte` conditions. Keys may be dot paths into to-one relations /
nested objects; a field is only added when at least one bound is present.

| Key          | Value                              |
| ------------ | ---------------------------------- |
| any path     | `{ from?: RangeBound; to?: RangeBound }` |

```ts
.range({ createdAt: { from, to }, 'avatar.size': { from: minSize } })
```

To-many relation filtering: use [`.where()`](#where) with Prisma relation
filters (`some`/`none`/`every`).

## `.where()`

```ts
where(condition: WhereOf<D>): this
```

Adds an arbitrary, fully-typed Prisma `where` condition. Top-level `undefined`
values are stripped.

```ts
.where({ posts: { some: { status: 'PUBLISHED' } }, verified: true })
```

## `.sortBy()`

```ts
sortBy(params: { sortBy?: OrderKeyOf<D> | (string & {}); sortOrder?: SortOrder }): this
```

Single-key `orderBy` sugar; `sortOrder` defaults to `'desc'`; no-op without
`sortBy`; dot paths expand like `.range()`. The latest `.sortBy()`/`.orderBy()`
call wins.

```ts
.sortBy({ sortBy: 'createdAt', sortOrder: 'asc' })
.sortBy({ sortBy: 'avatar.size' })            // → { avatar: { size: 'desc' } }
```

## `.orderBy()`

```ts
orderBy(order: OrderByOf<D>): this
```

Sets `orderBy` verbatim from the full Prisma shape — arrays for multi-key
sorts, nested relation orders.

```ts
.orderBy([{ role: 'asc' }, { createdAt: 'desc' }])
```

## `.paginate()`

```ts
paginate(params: { page?: number; limit?: number }): this
```

Configures offset pagination: 1-based `page` (default 1) and page size
`limit` (default 10). Inputs are clamped — limits into `[1, 1000]`, pages
below 1 become 1, computed `skip` capped at `100,000`; with `strictNumbers: true`
all of these throw instead (see
[Offset pagination](../guides/pagination.md#clamping-and-limits)).

Ignored whenever cursor mode is configured —
[cursor beats offset](#cursorpaginate).

## `.cursorPaginate()`

```ts
cursorPaginate(params: {
  cursor?: string | number | Date | undefined;
  limit?: number;
  direction?: CursorDirection;                  // 'forward' | 'backward'
  cursorField?: OrderKeyOf<D> | (string & {});  // default 'id'
  strict?: boolean;                             // default false
}): this
```

Configures seek pagination for [`.executeWithCursor()`](#executewithcursor).

| Parameter     | Description                                                                 |
| ------------- | --------------------------------------------------------------------------- |
| `cursor`      | `cursorField` value from the previous page's edge row; omit for the first page. `Date`s serialize to ISO-8601 in returned cursors. |
| `limit`       | Page size (clamped like `.paginate()`). Default 10.                          |
| `direction`   | `'forward'` (next pages) or `'backward'` (previous pages). Output order always follows the configured sort. |
| `cursorField` | Unique, sequential column to seek on. Default `'id'`. Pair with a matching sort. |
| `strict`      | One extra 1-row probe query to make `hasNextPage`/`hasPrevPage` exact.       |

Details, walking examples and guards:
[Cursor pagination](../guides/cursor-pagination.md).

## `.select()`

```ts
select<TSelect extends SelectOf<D>>(
  select: TSelect,
): QueryBuilder<D, Omit<TArgs, 'select' | 'include'> & { select: TSelect }>
```

Projects fields with Prisma `select`; the result type of every execute method
narrows to exactly the selected shape. Clears any active `.include()`.

```ts
.select({ id: true, email: true })
// execute() → Promise<{ id: string; email: string }[]>
```

## `.include()`

```ts
include<TInclude extends IncludeOf<D>>(
  include: TInclude,
): QueryBuilder<D, Omit<TArgs, 'select' | 'include'> & { include: TInclude }>
```

Eager-loads relations with Prisma `include`; the result type widens with the
included relations, nested includes keeping each level's own fields. Clears
any active `.select()`.

```ts
.include({ posts: { include: { comments: true } } })
// execute() → Promise<(User & { posts: (Post & { comments: Comment[] })[] })[]>
```

`_count` widens in as `Record<string, number>` (wider-but-never-wrong; see
[Projections](../guides/projections.md#the-_count-gap-documented-limitation)).

## `.custom()`

```ts
custom(args: FindManyArgsOf<D>): this
```

Merges raw `findMany` args (`distinct`, `cursor`, a `where`, …):

- explicit methods beat custom args regardless of call order;
- a custom `where` is AND-ed with the `initialArgs` seed and previous custom
  `where`s — never replaces them;
- `undefined` is stripped at any depth; dangerous keys are refused.

```ts
.custom({ distinct: ['email'], where: { verified: true } })
```

---

## Terminal methods

## `buildArgs()`

```ts
buildArgs(): FindManyArgsOf<D>
```

The fully assembled `findMany` args, without executing. Useful for debugging
and for the passthrough `prisma.user.findMany(qb.buildArgs())`, which gets
100% Prisma-native inference.

```ts
const args = qb.filter({ status: 'ACTIVE' }).paginate({ page: 1, limit: 20 }).buildArgs();
// { where: { status: 'ACTIVE' }, take: 20, skip: 0 }
```

## `execute()`

```ts
async execute(): Promise<FindResultOf<D, TArgs>>
```

Runs `findMany(buildArgs())` and returns the rows, typed by your projection.
In cursor mode this returns raw seek-order rows **including the one-row
over-fetch** — use [`executeWithCursor()`](#executewithcursor) for trimmed
pages (documented limitation).

```ts
const users = await qb.select({ id: true }).execute(); // { id: string }[]
```

## `first()`

```ts
async first(): Promise<ApplyProjection<RowElementOf<D>, TArgs> | null>
```

Runs the query forced to `take: 1` with `skip`/`cursor` removed — the first
row of the **whole result set**, not of a configured page. Returns `null` when
nothing matched.

```ts
const user = await qb.filter({ email }).first();
```

## `firstOrThrow()`

```ts
async firstOrThrow(): Promise<ApplyProjection<RowElementOf<D>, TArgs>>
```

Like [`first()`](#first), but throws [`NoResultError`](#noresulterror) when no
row matched.

```ts
const user = await qb.filter({ id }).firstOrThrow(); // throws NoResultError
```

## `count()`

```ts
async count(): Promise<number>
```

Counts rows matching the current filters via `delegate.count({ where })`.
Pagination and projections are ignored.

```ts
const total = await qb.filter({ status: 'ACTIVE' }).count();
```

## `executeWithMeta()`

```ts
async executeWithMeta<O extends { includeTotal?: boolean } = { includeTotal?: boolean }>(
  opts?: O,
): Promise<{ meta: MetaOf<O>; data: FindResultOf<D, TArgs> }>
```

Offset-mode execution: rows plus pagination metadata. `count()` and
`findMany()` run in parallel.

| Option         | Effect                                                                    |
| -------------- | ------------------------------------------------------------------------- |
| _(none)_       | `meta: PaginationMeta` — `{ page, limit, total, totalPage }`               |
| `includeTotal: false` | Skips the `COUNT` query; `meta: PaginationMetaNoTotal` — `total: null`, `totalPage: null` |

Behavior:

- Without pagination configured, defaults to page 1, limit 10 so `meta` always
  describes the returned data.
- **Throws when cursor pagination is configured** — offset meta cannot
  describe a seek query; use [`executeWithCursor()`](#executewithcursor).
- With `strictNumbers: true`, an out-of-cap skip throws before the `COUNT`
  goes out.

```ts
const { meta, data } = await qb.paginate({ page: 2, limit: 20 }).executeWithMeta();
```

## `executeWithCursor()`

```ts
async executeWithCursor(): Promise<{ meta: CursorMeta; data: FindResultOf<D, TArgs> }>
```

Cursor-mode execution: trimmed, sort-ordered page rows plus
[`CursorMeta`](./types.md#cursormeta) (`limit`, `nextCursor`, `prevCursor`,
`hasNextPage`, `hasPrevPage`).

- Rows always follow the configured sort order, regardless of `direction`.
- Throws when a `.select()` projection drops `cursorField`.
- Callable without any `.cursorPaginate()` — paginates with defaults
  (first page, limit 10, `id`, forward).

```ts
const { meta, data } = await qb
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({ cursor: prev?.meta.nextCursor, limit: 20 })
  .executeWithCursor();
```

---

## `NoResultError`

```ts
class NoResultError extends Error
```

Thrown by [`firstOrThrow()`](#firstorthrow) when the query matched no rows.
`name` is `'NoResultError'`, `message` `'Query returned no rows'` — catch it
by type, not by message:

```ts
import { NoResultError } from 'query-builder-prisma';

try {
  user = await qb.firstOrThrow();
} catch (e) {
  if (e instanceof NoResultError) { /* 404 */ }
}
```

## `QueryBuilderOptions`

Constructor options — full shape in [Types](./types.md#querybuilderoptions);
usage under [constructor](#constructor).
