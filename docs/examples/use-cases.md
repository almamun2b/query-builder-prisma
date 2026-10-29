# Use cases

End-to-end scenarios showing the builder in realistic shapes. Examples assume
a Prisma client with `User`/`Post` models (`id`, `email`, `status`, `role`,
`createdAt`, `deletedAt`, `tenantId`, an `avatar` relation, and a to-many
`posts` relation) — adapt names to your schema.

## Setup: configure the dialect once

The examples below pass `{ dialect: 'postgresql' }` per builder so each
snippet is self-contained. In a real app, configure the dialect once at
startup — next to where you create `PrismaClient` — and drop the option from
every call site:

```ts
// src/db.ts — the module that exports your Prisma client
import { PrismaClient } from '@prisma/client';
import { configQueryBuilder } from 'query-builder-prisma';

export const prisma = new PrismaClient();

configQueryBuilder({ dialect: 'postgresql' });
```

The dialect is resolved when a dialect-aware method runs (e.g. `.search()`),
not at builder construction, so any startup placement before the first request
works. Per-builder `{ dialect }` remains as the override for the rare process
that talks to databases with different providers. Details:
[Dialects — where to put the global config](../guides/dialects.md#where-to-put-the-global-config).

## 1. Paginated admin table from REST query params

The classic listing endpoint: search box, dropdown filters, date range,
sortable columns, numbered pages. `undefined` forwarding makes optional
params inert; clamping keeps hostile numbers safe.

```ts
// GET /admin/users?q=&role=&status=&from=&to=&sort=&page=&limit=
app.get('/admin/users', async (req, res) => {
  const q = req.query;

  const { meta, data } = await new QueryBuilder(prisma.user, { dialect: 'postgresql' })
    .search({ searchText: q.q, fields: ['email', 'username'] })
    .filter({ role: q.role, status: q.status })
    .range({
      createdAt: {
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
      },
    })
    .sortBy({ sortBy: q.sort ?? 'createdAt', sortOrder: q.order === 'asc' ? 'asc' : 'desc' })
    .paginate({ page: Number(q.page ?? 1), limit: Number(q.limit ?? 25) })
    .select({ id: true, email: true, username: true, role: true, status: true, createdAt: true })
    .executeWithMeta();

  res.json({ meta, data });
});
```

## 2. Infinite scroll feed (forward cursor)

A feed that grows and is read front-to-back: offset pagination would skip or
repeat rows as new items arrive; seek pagination stays stable. The client
stores `meta.nextCursor` and sends it back for the next chunk.

```ts
// GET /feed?cursor=<opaque>
app.get('/feed', async (req, res) => {
  const { meta, data } = await new QueryBuilder(prisma.post)
    .where({ status: 'PUBLISHED' })
    .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
    .cursorPaginate({
      cursor: req.query.cursor,          // undefined on the first request
      cursorField: 'createdAt',
      limit: 10,
    })
    .executeWithCursor();

  res.json({ nextCursor: meta.nextCursor, hasNextPage: meta.hasNextPage, posts: data });
});
```

## 3. Backward paging ("load newer", history back-fill)

The same cursor walks both ways. `direction: 'backward'` fetches the rows
*before* the cursor while **output stays in configured sort order**, so the
client can prepend the chunk without reversing it.

```ts
const page = await new QueryBuilder(prisma.message)
  .where({ channelId })
  .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
  .cursorPaginate({
    cursor: oldestLoaded.createdAt,      // ISO string round-trips (Date → ISO-8601)
    cursorField: 'createdAt',
    direction: 'backward',
    limit: 30,
    strict: true,                        // exact hasPrevPage — no dead "load older" button
  })
  .executeWithCursor();

prependToHistory(page.data);             // already oldest → newest
```

## 4. Relay-style connection shape

`executeWithCursor()` maps naturally onto a GraphQL/Relay connection: opaque
cursors, page info, edges.

```ts
export async function usersConnection(first: number, after?: string) {
  const { meta, data } = await new QueryBuilder(prisma.user)
    .sortBy({ sortBy: 'id' })
    .cursorPaginate({ cursor: after, cursorField: 'id', limit: first })
    .executeWithCursor();

  return {
    edges: data.map((user, i) => ({
      node: user,
      cursor: i === data.length - 1 ? meta.nextCursor : undefined,
    })),
    pageInfo: {
      hasNextPage: meta.hasNextPage,
      hasPreviousPage: meta.hasPrevPage,
      endCursor: meta.nextCursor,
      startCursor: meta.prevCursor,
    },
  };
}
```

## 5. Soft delete via `initialArgs`

Every query from a factory carries `deletedAt: null` — and because the seed
is AND-ed rather than replaceable, no later `.custom({ where })` can lose it.

```ts
export function usersFor(delegate: typeof prisma.user) {
  return new QueryBuilder(delegate, {
    initialArgs: { where: { deletedAt: null } },
  });
}

// anywhere in the app:
const active = await usersFor(prisma.user)
  .search({ searchText: q, fields: ['email'] })
  .paginate({ page, limit })
  .executeWithMeta();
// where: { AND: [{ deletedAt: null }, { OR: [...] }] }
```

## 6. Multi-tenant scoping

Same mechanism, one seed per tenant. Build the factory once; the tenant filter
is structural, not something each call site must remember.

```ts
export const tenantUsers = (tenantId: string) =>
  new QueryBuilder(prisma.user, {
    dialect: 'postgresql',
    initialArgs: { where: { tenantId, deletedAt: null } },
  });

const { data } = await tenantUsers(session.tenantId)
  .filter({ role: 'EDITOR' })
  .custom({ where: { verified: true } })   // AND-ed with the seed, never replaces it
  .orderBy([{ role: 'asc' }, { createdAt: 'desc' }])
  .execute();
```

## 7. Date-range dashboard with relation dot paths

`.range()` reaches through to-one relations with dot paths; to-many filters
use `.where()` with relation operators.

```ts
const { meta, rows } = await new QueryBuilder(prisma.user, { dialect: 'postgresql' })
  .range({
    createdAt: { from: monthStart, to: monthEnd },
    'avatar.size': { from: 1024 },                    // avatar is to-one
  })
  .where({ posts: { some: { publishedAt: { gte: monthStart } } } }) // posts is to-many
  .sortBy({ sortBy: 'createdAt' })
  .paginate({ page: 1, limit: 50 })
  .executeWithMeta();
```

## 8. DTO → builder in NestJS

A service method maps a validated DTO straight onto the chain. Fresh builder
per call — the service is a singleton, the builder is not.

```ts
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListUsersDto) {
    return new QueryBuilder(this.prisma.user, { dialect: 'postgresql' })
      .search({ searchText: dto.q, fields: ['email', 'username'] })
      .filter({ role: dto.role, status: dto.status })
      .sortBy({ sortBy: dto.sortBy ?? 'createdAt', sortOrder: dto.sortOrder ?? 'desc' })
      .paginate({ page: dto.page, limit: dto.limit })
      .select({ id: true, email: true, role: true, status: true, createdAt: true })
      .executeWithMeta();
  }
}
```

Injectable seam: see the factory-provider recipe in
[Framework recipes](../framework-recipes.md#nestjs).

## 9. Deep pagination: know when to switch to cursors

Offset pages get slower linearly (`skip` grows) and drift on live data. The
default clamping keeps hostile numbers bounded; `strictNumbers: true` surfaces
abusive pages as errors instead, so you can return a 400 and point the client
at the cursor endpoint:

```ts
app.get('/items', async (req, res, next) => {
  try {
    // Throws when computed skip > 100,000 — treat as a client bug, not a cap
    const { meta, data } = await new QueryBuilder(prisma.item, { strictNumbers: true })
      .filter({ status: 'ACTIVE' })
      .paginate({ page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 25) })
      .executeWithMeta();
    res.json({ meta, data });
  } catch (e) {
    next(e); // handler returns 400 with a hint to use /items?cursor=…
  }
});

// Large tables: expose cursor pagination instead — see use case 2.
```

Rule of thumb: totals + numbered pages for admin screens; cursors for feeds,
exports and anything unbounded.

## 10. `_count` with exact types via the passthrough

`.include({ _count: true })` is typed wide (`Record<string, number>`) by
design. When a caller needs the exact per-relation shape, hand `buildArgs()`
to Prisma's own `findMany`:

```ts
const qb = new QueryBuilder(prisma.user)
  .filter({ status: 'ACTIVE' })
  .include({ _count: { select: { posts: true, followers: true } } })
  .paginate({ page: 1, limit: 20 });

const users = await prisma.user.findMany(qb.buildArgs());
// users: Prisma's own exact GetFindResult type — _count: { posts: number; followers: number }
```

Both calls run the identical args — the builder's own `execute()` would return
the same rows with the wider-but-correct `_count` typing.

## Related

- [Framework recipes](../framework-recipes.md) — Next.js, NestJS, Express, edge
- [Guides](../index.md#guides) — the building blocks used above
