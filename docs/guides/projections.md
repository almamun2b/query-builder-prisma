# Projections (select/include)

`.select()` and `.include()` narrow or widen the result type of every execute
method through a structural projection engine — the same narrowing you know
from Prisma, computed from your delegate's own types without importing any
Prisma type.

```ts
const users = await new QueryBuilder(prisma.user)
  .select({ id: true, email: true })
  .execute();
// users: { id: string; email: string }[]
```

## Rules at a glance

- `.select()` keeps only the selected fields. It **clears any active
  `.include()`** and vice versa — the latest projection wins, like Prisma.
- `.include()` keeps all base fields and adds the included relations.
- Nested specs recurse into relation types; arrays map over their element;
  `| null | undefined` optionality is preserved exactly.
- When the engine cannot mirror Prisma exactly, the type **degrades wider,
  never wrong** (the one case today is `_count`, below).

## select

```ts
select<TSelect extends SelectOf<D>>(select: TSelect): QueryBuilder<D, ...>
```

Flat selects narrow to exactly the chosen fields, preserving nullability:

```ts
.select({ id: true, name: true })
// → { id: string; name: string | null }[]
```

Nested selects project relations recursively:

```ts
.select({ id: true, posts: { select: { title: true } } })
// → { id: string; posts: { title: string }[] }[]
```

## include

```ts
include<TInclude extends IncludeOf<D>>(include: TInclude): QueryBuilder<D, ...>
```

Flat includes intersect the base row with the relation:

```ts
.include({ posts: true })
// → (User & { posts: Post[] })[]

.include({ profile: true })               // nullable relation
// → (User & { profile: Profile | null })[]
```

Nested includes keep **every level's own fields** — unlike a naive mapped
type, the relation's base row survives:

```ts
.include({ posts: { include: { comments: true } } })
// → (User & { posts: (Post & { comments: Comment[] })[] })[]

.include({ profile: { include: { tags: true } } })
// → (User & { profile: (Profile & { tags: Tag[] }) | null })[]
```

Mixing `include` with an inner `select` projects the inner relation:

```ts
.include({ posts: { select: { id: true } } })
// → (User & { posts: { id: string }[] })[]
```

## The `_count` gap (documented limitation)

`_count: true` widens the result type with `_count: Record<string, number>` —
present and correct at runtime, but the statically-known relation keys are
wider than Prisma's exact per-relation shape. This is the deliberate
*wider-but-never-wrong* degradation:

```ts
.include({ posts: true, _count: true })
// → (User & { posts: Post[]; _count: Record<string, number> })[]
```

Need the exact shape? Use the passthrough (next section).

## The passthrough: 100% Prisma-native inference

`buildArgs()` returns the fully assembled `findMany` args, typed with the
accumulated projection. Hand them to Prisma's own `findMany` and its overloads
give you the exact native result type — same query, zero divergence:

```ts
const args = new QueryBuilder(prisma.user)
  .include({ _count: { select: { posts: true } } })
  .buildArgs();

const users = await prisma.user.findMany(args); // Prisma's own inference, exact
```

This passthrough always exists and is the escape hatch for anything the
structural engine types wider than you need.

## Projection + pagination interplay

Projections compose with both pagination modes:

- `executeWithMeta()` runs `count()` + `findMany()` in parallel; `data` is
  narrowed by your projection, `meta` is unaffected.
- `executeWithCursor()` **requires the cursor field to survive the
  projection** — it throws when `.select()` drops `cursorField`, because page
  cursors would be built from `undefined`. See
  [Cursor pagination → Guards](./cursor-pagination.md#guards).

## Related

- [Cursor pagination](./cursor-pagination.md#guards) — the projection guard
- [Known limitations](../../README.md#known-limitations) — the `_count` gap
- [QueryBuilder API — select](../api/query-builder.md#select) /
  [include](../api/query-builder.md#include)
