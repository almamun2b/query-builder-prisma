/**
 * A delegate shaped like Prisma's generated one: `findMany` is a *generic* method whose
 * default (constraint-instantiated) result is the scalar-only row, relations are absent
 * from the row type. Verified against a real generated client (Prisma 7.10.1): the
 * result of `RowElementOf` is `{ id; email; name }` without `posts`.
 * Relations requested through `select`/`include` must therefore degrade to `unknown`
 * (wider, never dropped).
 */
import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { Equal, Expect } from './helpers';

interface ScalarUser {
  id: number;
  email: string;
  name: string | null;
}

interface UserArgs {
  where?: Record<string, unknown>;
  select?: {
    id?: boolean;
    email?: boolean;
    name?: boolean;
    posts?: boolean | { select?: { id?: boolean } };
    _count?: boolean | { select?: { posts?: boolean } };
  };
  include?: {
    posts?: boolean | { select?: { id?: boolean } };
    _count?: boolean | { select?: { posts?: boolean } };
  };
  orderBy?: Record<string, 'asc' | 'desc'>;
  skip?: number;
  take?: number;
  cursor?: { id?: number };
}

interface PrismaShapedDelegate extends PrismaModelDelegate {
  findMany<T extends UserArgs>(args?: T): Promise<ScalarUser[]>;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
}

declare const delegate: PrismaShapedDelegate;

// include of a relation missing from the row: kept, typed unknown
const _inc = new QueryBuilder(delegate).include({ posts: true }).execute();
const _p1: Expect<Equal<Awaited<typeof _inc>, (ScalarUser & { posts: unknown })[]>> = true;

// select of a relation missing from the row: kept, typed unknown
const _sel = new QueryBuilder(delegate).select({ id: true, posts: true }).execute();
const _p2: Expect<Equal<Awaited<typeof _sel>, { id: number; posts: unknown }[]>> = true;

// nested spec on a missing relation still degrades to unknown
const _selNested = new QueryBuilder(delegate)
  .select({ id: true, posts: { select: { id: true } } })
  .execute();
const _p3: Expect<Equal<Awaited<typeof _selNested>, { id: number; posts: unknown }[]>> = true;

// `_count` is never on the row but is a real Prisma key
const _cnt = new QueryBuilder(delegate).include({ _count: true }).execute();
const _p4: Expect<
  Equal<Awaited<typeof _cnt>, (ScalarUser & { _count: Record<string, number> })[]>
> = true;

// scalar fields on the row still narrow exactly
const _scalar = new QueryBuilder(delegate).select({ id: true, email: true }).execute();
const _p5: Expect<Equal<Awaited<typeof _scalar>, { id: number; email: string }[]>> = true;

// --- the buildArgs() passthrough recovers Prisma-native inference ---
// A delegate whose result depends on the args, like Prisma's generated `findMany<T>`.

interface Post {
  id: number;
  title: string;
}

interface ArgAwareDelegate extends PrismaModelDelegate {
  findMany<T extends UserArgs>(
    args?: T,
  ): Promise<
    T extends { include: { posts: true } } ? (ScalarUser & { posts: Post[] })[] : ScalarUser[]
  >;
  count(args?: { where?: Record<string, unknown> }): Promise<number>;
}

declare const argAware: ArgAwareDelegate;

const _passthrough = argAware.findMany(
  new QueryBuilder(argAware).include({ posts: true }).buildArgs(),
);
const _p6: Expect<Equal<Awaited<typeof _passthrough>, (ScalarUser & { posts: Post[] })[]>> = true;

// custom() projections reach the passthrough too
const _passthroughCustom = argAware.findMany(
  new QueryBuilder(argAware).custom({ include: { posts: true } }).buildArgs(),
);
const _p7: Expect<Equal<Awaited<typeof _passthroughCustom>, (ScalarUser & { posts: Post[] })[]>> =
  true;

// no projection: the plain scalar row
const _passthroughPlain = argAware.findMany(new QueryBuilder(argAware).buildArgs());
const _p8: Expect<Equal<Awaited<typeof _passthroughPlain>, ScalarUser[]>> = true;
