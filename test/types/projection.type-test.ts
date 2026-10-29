import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { FindResultOf } from '../../src/types/projection';

interface Comment {
  id: string;
  body: string;
}

interface Tag {
  id: string;
  label: string;
}

interface Profile {
  id: string;
  bio: string;
  tags: Tag[];
}

interface Post {
  id: string;
  title: string;
  published: boolean;
  comments: Comment[];
}

interface User {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  posts: Post[];
  profile: Profile | null;
}

interface UserFindArgs {
  where?: Record<string, unknown>;
  select?: {
    id?: boolean;
    email?: boolean;
    name?: boolean;
    createdAt?: boolean;
    posts?: boolean | { select?: { id?: boolean; title?: boolean } };
    profile?: boolean | { select?: { id?: boolean; bio?: boolean } };
  };
  include?: {
    posts?:
      | boolean
      | {
          select?: { id?: boolean; title?: boolean };
          include?: { comments?: boolean | { select?: { body?: boolean } } };
        };
    profile?:
      | boolean
      | {
          select?: { id?: boolean; bio?: boolean };
          include?: { tags?: boolean | { select?: { label?: boolean } } };
        };
    _count?: boolean | { select?: Record<string, boolean> };
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

// --- nested include keeps the relation's own fields (audit F3 regression) ---

// nested include: base fields survive on every level
const _nestedInclude = new QueryBuilder(userDelegate)
  .include({ posts: { include: { comments: true } } })
  .execute();
const _7: Expect<
  Equal<Awaited<typeof _nestedInclude>, (User & { posts: (Post & { comments: Comment[] })[] })[]>
> = true;

// nested include with an inner select: both relation's base fields survive
const _nestedIncludeSelect = new QueryBuilder(userDelegate)
  .include({ posts: { include: { comments: { select: { body: true } } } } })
  .execute();
const _8: Expect<
  Equal<
    Awaited<typeof _nestedIncludeSelect>,
    (User & { posts: (Post & { comments: { body: string }[] })[] })[]
  >
> = true;

// nullability is preserved through a nested include on a nullable relation
const _nullableNestedInclude = new QueryBuilder(userDelegate)
  .include({ profile: { include: { tags: true } } })
  .execute();
const _9: Expect<
  Equal<
    Awaited<typeof _nullableNestedInclude>,
    (User & { profile: (Profile & { tags: Tag[] }) | null })[]
  >
> = true;

// flat include of the nullable relation stays exactly as before (regression guard)
const _flatNullable = new QueryBuilder(userDelegate).include({ profile: true }).execute();
const _10: Expect<Equal<Awaited<typeof _flatNullable>, (User & { profile: Profile | null })[]>> =
  true;

// --- `_count` include widens in (audit F9 regression) ---

// `_count: true` alongside a relation include: the count record is typed wide
const _countInclude = new QueryBuilder(userDelegate)
  .include({ posts: true, _count: true })
  .execute();
const _11: Expect<
  Equal<Awaited<typeof _countInclude>, (User & { posts: Post[]; _count: Record<string, number> })[]>
> = true;

// `_count` with a nested select resolves to the same wide-but-correct record
const _countSelect = new QueryBuilder(userDelegate)
  .include({ _count: { select: { posts: true } } })
  .execute();
const _12: Expect<
  Equal<Awaited<typeof _countSelect>, (User & { _count: Record<string, number> })[]>
> = true;

// include without `_count` gains no `_count` key (no phantom fields)
const _noCount = new QueryBuilder(userDelegate).include({ posts: true }).execute();
const _13: Expect<Equal<Awaited<typeof _noCount>, (User & { posts: Post[] })[]>> = true;
