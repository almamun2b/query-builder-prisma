# Types

Every exported type, grouped by role. All of them are re-exported from the
package root — `import type { FilterInput } from 'query-builder-prisma'`.
The generic parameter `D` throughout is a model delegate
(`typeof prisma.user`).

## Options and inputs

### `QueryBuilderOptions`

Options for the `QueryBuilder` constructor.

```ts
interface QueryBuilderOptions<D extends PrismaModelDelegate> {
  /** Seed `findMany` args, e.g. `{ where: { deletedAt: null } }` (prepended to every `where`). */
  initialArgs?: FindManyArgsOf<D> | undefined;
  /** Per-builder dialect override; falls back to global config → detector → 'universal'. */
  dialect?: Dialect | undefined;
  /** Throw on out-of-range pagination input instead of clamping silently. */
  strictNumbers?: boolean | undefined;
}
```

See: [Advanced patterns](../guides/advanced.md#initialargs--a-safety-seed),
[Dialects](../guides/dialects.md).

### `FilterInput`

A partial `where` whose values may also be `undefined` — the input type of
[`.filter()`](./query-builder.md#filter).

```ts
type FilterInput<D extends PrismaModelDelegate> = {
  [K in WhereKeyOf<D>]?: WhereOf<D>[K] | undefined;
};
```

### `RangeInput`

Open/closed bounds for one field path — the value type in
[`.range()`](./query-builder.md#range). Omitted bounds are skipped.

```ts
interface RangeInput {
  from?: RangeBound | undefined;
  to?: RangeBound | undefined;
}
```

### `RangeBound`

A single numeric/date/string bound used by `.range()`.

```ts
type RangeBound = string | number | Date;
```

### `SortOrder`

Sort direction accepted by Prisma's `orderBy`.

```ts
type SortOrder = 'asc' | 'desc';
```

### `CursorDirection`

Direction to walk through a cursor-paginated result set.

```ts
type CursorDirection = 'forward' | 'backward';
```

## Pagination metadata

### `PaginationMeta`

Offset pagination metadata returned by `executeWithMeta()`.

```ts
interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
}
```

### `PaginationMetaNoTotal`

Metadata shape when `executeWithMeta({ includeTotal: false })` skips the
`COUNT` query — the totals are unknown, not zero.

```ts
interface PaginationMetaNoTotal {
  page: number;
  limit: number;
  total: null;
  totalPage: null;
}
```

### `CursorMeta`

Cursor pagination metadata returned by `executeWithCursor()`.

```ts
interface CursorMeta {
  limit: number;
  /** Cursor to pass as `cursor` to fetch the next page (`null` if none). */
  nextCursor: string | null;
  /** Cursor to pass as `cursor` (with `direction: 'backward'`) for the previous page. */
  prevCursor: string | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}
```

## Dialects

### `DialectCapabilities`

Per-database capability set consulted by dialect-aware methods
(see [Dialects](../guides/dialects.md)).

```ts
interface DialectCapabilities {
  /** Prisma accepts `mode: 'insensitive'` on string filters (postgresql, cockroachdb, mongodb). */
  caseInsensitiveMode: boolean;
  /** The default collation makes `contains` case-insensitive (mysql, mariadb, sqlserver). */
  caseInsensitiveCollation: boolean;
}
```

### `Dialect`

Names of the built-in dialects — the keys of
[`DIALECT_CAPABILITIES`](./functions.md#dialect_capabilities).

```ts
type Dialect =
  | 'postgresql' | 'cockroachdb' | 'mysql' | 'mariadb'
  | 'sqlite' | 'sqlserver' | 'mongodb' | 'universal';
```

### `ResolvedDialect`

A dialect name plus the capabilities resolved for it — the return type of
[`resolveDialect()`](./functions.md#resolvedialect).

```ts
interface ResolvedDialect {
  name: string;
  capabilities: DialectCapabilities;
}
```

## Structural extractors

These types derive Prisma argument/result shapes **from the delegate** — the
package's entire type-level knowledge of Prisma. They are exported for
advanced wiring (factories, wrappers, generic services) and are exactly what
the builder uses internally.

### `PrismaModelDelegate`

The minimal structural contract every Prisma model delegate already satisfies:
`findMany` + `count` with the standard call shape. Used as the generic upper
bound.

```ts
interface PrismaModelDelegate {
  findMany: (...args: never[]) => unknown;
  count: (...args: never[]) => unknown;
}
```

### `FindManyArgsOf`

The `findMany` arguments object for the delegate — the input type of
[`.custom()`](./query-builder.md#custom) and return type of
[`buildArgs()`](./query-builder.md#buildargs).

```ts
type FindManyArgsOf<D extends PrismaModelDelegate> = NonNullable<Parameters<D['findMany']>[0]>;
```

### `WhereOf` / `WhereKeyOf`

The model's `where` input, and the string keys that can appear in it.

```ts
type WhereOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['where']>;
type WhereKeyOf<D extends PrismaModelDelegate> = keyof WhereOf<D> & string;
```

### `SelectOf` / `IncludeOf`

The model's `select` / `include` inputs — the bounds for
[`.select()`](./query-builder.md#select) / [`.include()`](./query-builder.md#include).

```ts
type SelectOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['select']>;
type IncludeOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['include']>;
```

### `OrderByOf` / `OrderKeyOf`

The model's `orderBy` input, and the single keys it accepts.

```ts
type OrderByOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['orderBy']>;
type OrderKeyOf<D extends PrismaModelDelegate> =
  OrderByOf<D> extends infer O
    ? O extends readonly unknown[] ? keyof O[number] & string : keyof O & string
    : never;
```

### `RowsOf` / `RowElementOf`

The rows array `findMany` resolves to, and a single row of it.

```ts
type RowsOf<D extends PrismaModelDelegate> = Awaited<ReturnType<D['findMany']>>;
type RowElementOf<D extends PrismaModelDelegate> = RowsOf<D> extends readonly (infer E)[] ? E : never;
```

## Projection engine

The compile-time engine that narrows results like Prisma's own overloads
(see [Projections](../guides/projections.md)). Degradation rule: when Prisma's
exact semantics can't be mirrored, the result is the *wider but correct* type.

### `ApplySelect`

Applies a `select` spec to a row: only selected fields remain, nested selects
recurse into relation element types.

### `ApplyInclude`

Applies an `include` spec: the base row is kept and included relations are
projected (recursively for nested includes; a truthy `_count` widens in as
`Record<string, number>`).

### `ApplyProjection`

Picks select vs include vs identity from the accumulated args type — the
engine behind every execute method's return type.

### `FindResultOf`

The array a builder's `execute()` resolves to for the given delegate + args.

```ts
type FindResultOf<D extends PrismaModelDelegate, TArgs> = ApplyProjection<RowElementOf<D>, TArgs>[];
```
