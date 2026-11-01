# Filtering and search

Four chain methods add conditions to the query. They are additive: every
condition you add is AND-ed with the others in the final `where`. All of them
strip `undefined` values, so optional inputs (query params, DTO fields) are
safe to pass directly.

```ts
import { QueryBuilder } from 'query-builder-prisma';

new QueryBuilder(prisma.user)
  .search({ searchText: q, fields: ['email', 'username'] }) // OR across fields
  .filter({ role, status }) // equality / operators
  .range({ createdAt: { from, to } }) // gte / lte
  .where({ role: { in: ['ADMIN', 'EDITOR'] } }); // full typed where
// → all four AND-ed into one `where`
```

## `.search()` — case-insensitive text search

```ts
search(params: { searchText?: string | undefined; fields: WhereKeyOf<D>[] }): this
```

Adds a `contains` condition per field, wrapped in an `OR`:

```ts
.search({ searchText: 'ada', fields: ['email', 'username'] })
// where: { OR: [{ email: { contains: 'ada' } }, { username: { contains: 'ada' } }] }
```

Behavior:

- **Empty / whitespace-only `searchText` adds no condition** — safe to forward
  `params.get('q') ?? undefined` from a request.
- **Dialect-aware `mode`.** On PostgreSQL, CockroachDB and MongoDB the builder
  emits `{ contains: text, mode: 'insensitive' }`. On MySQL, MariaDB and
  SQL Server it emits the bare `contains` and relies on the database's default
  collation, which is already case-insensitive there. On SQLite the bare
  `contains` is ASCII-case-sensitive — Prisma accepts no `mode` there, so there
  is no alternative. See [Dialects](./dialects.md).
- Pass **scalar string fields only**. A relation key compiles (the type is a
  string key) but Prisma rejects it at runtime.
- Each `OR` arm gets its own match object — no shared references.

## `.filter()` — equality and operator filters

```ts
filter(filters: FilterInput<D>): this
```

Accepts a partial Prisma `where` object. `undefined` values are stripped, so
optional request fields can be forwarded as-is:

```ts
// GET /users?status=ACTIVE&role=ADMIN
.filter({ status: req.query.status, role: req.query.role, deletedAt: undefined })
// → where: { status: 'ACTIVE', role: 'ADMIN' }   (deletedAt dropped)
```

`FilterInput<D>` allows every `where` key with possibly-`undefined` values —
it exists exactly so you never need `?? undefined` gymnastics or manual
cleanup. Keys named `__proto__`, `constructor` or `prototype` are refused
(never written), which hardens builders fed from parsed JSON.

## `.range()` — `gte`/`lte` bounds

```ts
range(ranges: Record<string, RangeInput>): this
```

Each key maps to `{ from?, to? }` bounds (`RangeBound` = string | number |
Date). A field is only added when at least one bound is present:

```ts
.range({
  createdAt: { from: new Date('2026-01-01'), to: new Date('2026-02-01') },
  'avatar.size': { from: 100 },               // dot path → { avatar: { size: { gte: 100 } } }
  deletedAt: { from: undefined, to: undefined } // both missing → no condition
})
```

Behavior:

- **Dot paths reach to-one relations and nested objects** — `'avatar.size'`
  expands to `{ avatar: { size: { gte: ... } } }`.
- **To-many relations need `.where()` or `.custom()`** — use Prisma's relation
  filters directly: `.where({ posts: { some: { rating: { gte: 4 } } } })`.
- Bounds left `undefined` are skipped; a path with a dangerous key
  (`__proto__`/`constructor`/`prototype`) expands to nothing.

## `.where()` — the full typed `where`

```ts
where(condition: WhereOf<D>): this
```

For everything the convenience methods don't cover — relation filters, `NOT`,
`in`, `null` checks — with the complete Prisma `where` type for your model:

```ts
.where({
  OR: [{ verified: true }, { email: { endsWith: '@company.dev' } }],
  posts: { some: { status: 'PUBLISHED' } },
})
```

`undefined` values at the top level are stripped, like `.filter()`.

## How conditions combine

At build time all conditions are folded into a single `where`:

1. A seeded `initialArgs.where` (constructor option) comes first.
2. Every condition from `.search()`, `.filter()`, `.range()`, `.where()` is
   AND-ed in call order.
3. `.custom({ where })` is AND-ed with all of the above — it never replaces
   the seed or earlier conditions.

A single condition is used as-is; multiple conditions are wrapped as
`{ AND: [...] }`, which Prisma treats identically.

```ts
const qb = new QueryBuilder(prisma.user, {
  initialArgs: { where: { deletedAt: null } }, // safety seed
})
  .filter({ role: 'ADMIN' })
  .custom({ where: { verified: true } });

// → where: { AND: [{ deletedAt: null }, { role: 'ADMIN' }, { verified: true }] }
```

The seed is protected: a later `.custom({ where })` merges with it instead of
replacing it, so safety filters like soft-delete or tenant scoping cannot be
lost. See [Advanced patterns](./advanced.md).

## Related

- [Sorting](./sorting.md) — order the filtered results
- [Advanced patterns](./advanced.md) — `custom()`, seeding, hardening
- [QueryBuilder API](../api/query-builder.md#search)
