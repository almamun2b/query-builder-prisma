# Advanced patterns

## `.custom()` — raw args, safely merged

```ts
custom(args: FindManyArgsOf<D>): this
```

`.custom()` accepts anything `findMany` accepts — `distinct`, `cursor`, extra
options, a `where` — with full delegate-derived typing. It is the escape hatch
that stays inside the builder's assembly rules:

- **Explicit methods always win.** `.select()` beats `custom({ select })`,
  `.paginate()`/`.cursorPaginate()` beat `custom({ take })`,
  `.sortBy()`/`.orderBy()` beat `custom({ orderBy })` — regardless of call
  order.
- **`where` is AND-ed, never replaced.** A custom `where` merges with the
  `initialArgs` seed and any previous custom `where`. Successive calls may
  nest `{ AND: [...] }` groups; Prisma treats that identically.
- **`undefined` is stripped at any depth.** A later
  `custom({ distinct: undefined })` cannot overwrite an earlier value.
- **Dangerous keys are refused.** Keys named `__proto__`, `constructor` or
  `prototype` are never written — relevant when args are assembled from
  parsed JSON.

```ts
new QueryBuilder(prisma.user)
  .filter({ role: 'ADMIN' }) // explicit method…
  .custom({
    distinct: ['email'],
    where: { verified: true }, // …still applies alongside this
  })
  .custom({ distinct: undefined }); // cannot erase the value above
// → findMany({ where: { AND: [{ role: 'ADMIN' }, { verified: true }] },
//             distinct: ['email'] })
```

## `initialArgs` — a safety seed

The constructor's `initialArgs` seeds every query built from that instance.
Its `where` is AND-ed **in front of** everything else and can never be
replaced by later calls — use it for filters that must hold no matter what the
rest of the chain does:

```ts
// Soft delete + tenant scoping, enforced at the factory level
export function userQueryBuilder(tenantId: string) {
  return (delegate: typeof prisma.user) =>
    new QueryBuilder(delegate, {
      dialect: 'postgresql',
      initialArgs: { where: { deletedAt: null, tenantId } },
    });
}

// Every query from here carries the seed — even ones that call .custom({ where })
const qb = userQueryBuilder('t_42')(prisma.user).filter({ role: 'ADMIN' });
```

Any non-`where` keys in `initialArgs` seed the same slots `.custom()` merges
into, with the same precedence rules (explicit methods win).

## `strictNumbers` — throw instead of clamp

By default out-of-range pagination numbers are clamped
([Offset pagination → Clamping](./pagination.md#clamping-and-limits)).
`strictNumbers: true` converts every clamp into a thrown `Error`:

- `limit` outside `[1, 1000]` or non-finite → throws
- page below 1 or non-finite → throws
- a computed `skip` beyond `100_000` → throws, **before** the `COUNT` query
  goes out in `executeWithMeta()`

```ts
const qb = new QueryBuilder(prisma.user, { strictNumbers: true });
```

Guideline: clamp (default) on public endpoints fed by users; `strictNumbers`
on internal surfaces where a bad number is a bug you want surfaced.

## One builder per query

The builder accumulates conditions as **instance state**. Sharing an instance
across concurrent requests mixes conditions between them. Instances are cheap
— create one where you query, never at module scope, never as a singleton:

```ts
// ✗ module scope — shared by every request
export const qb = new QueryBuilder(prisma.user);

// ✓ created per request, inside the handler
app.get('/users', async (req, res) => {
  const users = await new QueryBuilder(prisma.user)
    .filter({ status: req.query.status })
    .executeWithMeta();
  res.json(users);
});
```

Never pass a builder instance across a server/client boundary or into a
cache — it holds the delegate. Framework-specific wiring (Next.js, NestJS,
Express, edge runtimes):
[Framework recipes](../framework-recipes.md).

## `buildArgs()` — debugging and passthrough

`buildArgs()` returns the fully assembled `findMany` args without executing:

```ts
const qb = new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .paginate({ page: 1, limit: 20 })
  .select({ id: true });

console.log(qb.buildArgs());
// { where: { status: 'ACTIVE' }, take: 20, skip: 0, select: { id: true } }
```

Two uses:

1. **Debugging** — log exactly what would be sent.
2. **Passthrough** — `prisma.user.findMany(qb.buildArgs())` runs the same
   query with Prisma's own 100%-exact type inference. See
   [Projections](./projections.md#the-passthrough-100-prisma-native-inference).

## Security posture

For builders fed from untrusted input (parsed JSON bodies, query strings):

- `undefined` values are stripped, so missing fields are inert.
- Keys `__proto__`, `constructor`, `prototype` are refused in `.custom()`,
  `.filter()` and dot-path expansion — prototype pollution via computed keys
  is not possible through builder-built objects.
- Pagination numbers are clamped (or throw under `strictNumbers`), so
  unbounded `skip`/`take` cannot reach the database.
- The builder only ever calls `findMany` and `count` on the delegate you hand
  it — it cannot escalate to other operations.

## Related

- [Behavior contracts](../../README.md#behavior-contracts) — the normative list
- [Framework recipes](../framework-recipes.md) — per-framework wiring
- [QueryBuilder API — custom](../api/query-builder.md#custom)
