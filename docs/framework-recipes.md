# Framework recipes

The one rule that matters in every framework: **one builder instance per query —
never share an instance across concurrent requests.** A builder accumulates
conditions (`search`, `filter`, `range`, …) as instance state, so a shared
instance mixes conditions between requests. Instances are cheap; create them
where you query.

## Next.js (App Router — route handlers / server actions)

Builders are created inside the handler, per request. Never pass a builder
instance (it holds the delegate) across the server/client boundary — pass the
plain result data instead.

```ts
// app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { QueryBuilder } from '@almamun2b/prisma-query-builder';

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  // Fresh builder per request — never module-scope.
  const qb = new QueryBuilder(prisma.user, { dialect: 'postgresql' })
    .search({
      searchText: params.get('q') ?? undefined,
      fields: ['email', 'username'],
    })
    .sortBy({ sortBy: params.get('sort') ?? 'createdAt' })
    .paginate({
      page: Number(params.get('page') ?? 1),
      limit: Number(params.get('limit') ?? 20),
    });

  const { meta, data } = await qb.executeWithMeta();
  return NextResponse.json({ meta, data }); // plain JSON, no builder objects
}
```

Server actions follow the same pattern: build and run inside the action.

## NestJS

Do **not** register a builder as a singleton provider — a singleton shares one
instance across all requests. Either create builders where they are used, or
provide a factory and call it per request.

```ts
// users.service.ts
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(dto: ListUsersDto) {
    // Fresh builder per call — the service is a singleton, the builder is not.
    return new QueryBuilder(this.prisma.user, { dialect: 'postgresql' })
      .search({ searchText: dto.q, fields: ['email'] })
      .filter({ role: dto.role })
      .paginate({ page: dto.page, limit: dto.limit })
      .executeWithMeta();
  }
}
```

If you want an injectable seam, provide a factory instead of an instance:

```ts
// query-builder.module.ts
@Module({
  providers: [
    {
      provide: 'QueryBuilderFactory',
      useFactory: (prisma: PrismaService) => ({
        for: <M extends PrismaModelDelegate>(delegate: M, options?: QueryBuilderOptions<M>) =>
          new QueryBuilder(delegate, options),
      }),
      inject: [PrismaService],
    },
  ],
  exports: ['QueryBuilderFactory'],
})
export class QueryBuilderModule {}
```

The factory object is stateless and safe as a singleton; the builders it creates
are per request by construction.

## Express / Fastify / Koa / Hono

Plain calls — create the builder inside the route handler:

```ts
app.get('/users', async (req, res) => {
  const { meta, data } = await new QueryBuilder(prisma.user)
    .filter({ status: req.query.status })
    .paginate({ page: Number(req.query.page ?? 1), limit: Number(req.query.limit ?? 20) })
    .executeWithMeta();
  res.json({ meta, data });
});
```

## Edge runtimes (Vercel Edge, Cloudflare Workers, Bun, Deno)

Nothing extra: the package has zero Node-API usage and ships pure ESM + CJS.
Deno consumes it via the npm specifier:

```ts
import { QueryBuilder } from 'npm:@almamun2b/prisma-query-builder';
```
