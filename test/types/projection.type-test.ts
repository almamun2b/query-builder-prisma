import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { FindResultOf } from '../../src/types/projection';

interface Post {
  id: string;
  title: string;
  published: boolean;
}

interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  posts: Post[];
}

interface UserFindArgs {
  where?: Record<string, unknown>;
  select?: {
    id?: boolean;
    email?: boolean;
    name?: boolean;
    createdAt?: boolean;
    posts?: boolean | { select?: { id?: boolean; title?: boolean } };
  };
  include?: {
    posts?: boolean | { select?: { id?: boolean; title?: boolean } };
  };
  orderBy?: Record<string, 'asc' | 'desc'>;
  skip?: number;
  take?: number;
}

interface UserDelegate extends PrismaModelDelegate {
  findMany: (args?: UserFindArgs) => Promise<User[]>;
  count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
}

declare const userDelegate: UserDelegate;

// --- strict type-equality helpers (verified by `npm run typecheck`) ---
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
  ? true
  : false;
type Expect<T extends true> = T;

// no projection => full row type
const _unprojected = new QueryBuilder(userDelegate).execute();
const _1: Expect<Equal<Awaited<typeof _unprojected>, User[]>> = true;

// flat select narrows the row
const _flat = new QueryBuilder(userDelegate).select({ id: true, email: true }).execute();
const _2: Expect<Equal<Awaited<typeof _flat>, { id: string; email: string }[]>> = true;

// nested select projects relations recursively
const _nested = new QueryBuilder(userDelegate)
  .select({ id: true, posts: { select: { title: true } } })
  .execute();
const _3: Expect<Equal<Awaited<typeof _nested>, { id: string; posts: { title: string }[] }[]>> =
  true;

// include keeps the base row and projects the relation
const _included = new QueryBuilder(userDelegate)
  .include({ posts: { select: { id: true } } })
  .execute();
const _4: Expect<
  Equal<Awaited<typeof _included>, (User & { posts: { id: string }[] })[]>
> = true;

// nullable field selection keeps nullability
const _withName = new QueryBuilder(userDelegate).select({ id: true, name: true }).execute();
const _5: Expect<Equal<Awaited<typeof _withName>, { id: string; name: string | null }[]>> = true;

// FindResultOf agrees with execute()
type Direct = FindResultOf<UserDelegate, { select: { id: true; email: true } }>;
const _6: Expect<Equal<Direct, { id: string; email: string }[]>> = true;
