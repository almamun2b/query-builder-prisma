import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { FindResultOf } from '../../src/types/projection';
import type { Equal, Expect } from './helpers';

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
    _count?: boolean | { select?: Record<string, boolean> };
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
const _4: Expect<Equal<Awaited<typeof _included>, (User & { posts: { id: string }[] })[]>> = true;

// nullable field selection keeps nullability
const _withName = new QueryBuilder(userDelegate).select({ id: true, name: true }).execute();
const _5: Expect<Equal<Awaited<typeof _withName>, { id: string; name: string | null }[]>> = true;

// FindResultOf agrees with execute()
type Direct = FindResultOf<UserDelegate, { select: { id: true; email: true } }>;
const _6: Expect<Equal<Direct, { id: string; email: string }[]>> = true;

// --- nested include keeps the relation's own fields ---

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

// --- `_count` include widens in ---

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

// --- `_count` in a select is kept (no longer dropped) ---

const _selectCount = new QueryBuilder(userDelegate).select({ id: true, _count: true }).execute();
const _14: Expect<
  Equal<Awaited<typeof _selectCount>, { id: string; _count: Record<string, number> }[]>
> = true;

const _selectCountNested = new QueryBuilder(userDelegate)
  .select({ id: true, _count: { select: { posts: true } } })
  .execute();
const _15: Expect<
  Equal<Awaited<typeof _selectCountNested>, { id: string; _count: Record<string, number> }[]>
> = true;

// --- non-literal boolean flags make a key optional, never required ---

declare const looseSelect: { id: true; email: boolean };
const _looseSelect = new QueryBuilder(userDelegate).select(looseSelect).execute();
const _16: Expect<Equal<Awaited<typeof _looseSelect>, { id: string; email?: string }[]>> = true;

// --- a flag of `false` selects nothing ---

const _falseFlag = new QueryBuilder(userDelegate).select({ id: true, email: false }).execute();
const _17: Expect<Equal<Awaited<typeof _falseFlag>, { id: string }[]>> = true;

// --- projections supplied through custom() are tracked (explicit methods still win) ---

const _customSelect = new QueryBuilder(userDelegate).custom({ select: { id: true } }).execute();
const _18: Expect<Equal<Awaited<typeof _customSelect>, { id: string }[]>> = true;

const _customInclude = new QueryBuilder(userDelegate)
  .custom({ include: { posts: true } })
  .execute();
const _19: Expect<Equal<Awaited<typeof _customInclude>, (User & { posts: Post[] })[]>> = true;

// an explicit .select() before custom() keeps winning, in the type as at runtime
const _explicitThenCustom = new QueryBuilder(userDelegate)
  .select({ email: true })
  .custom({ select: { id: true } })
  .execute();
const _20: Expect<Equal<Awaited<typeof _explicitThenCustom>, { email: string }[]>> = true;

// an explicit .select() after custom() replaces it
const _customThenExplicit = new QueryBuilder(userDelegate)
  .custom({ select: { id: true } })
  .select({ email: true })
  .execute();
const _21: Expect<Equal<Awaited<typeof _customThenExplicit>, { email: string }[]>> = true;

// a later custom() replaces an earlier one
const _customTwice = new QueryBuilder(userDelegate)
  .custom({ select: { id: true } })
  .custom({ select: { email: true } })
  .execute();
const _22: Expect<Equal<Awaited<typeof _customTwice>, { email: string }[]>> = true;

// custom() without a projection leaves the row untouched
const _customWhere = new QueryBuilder(userDelegate)
  .custom({ where: { id: 'u1' }, take: 5 })
  .execute();
const _23: Expect<Equal<Awaited<typeof _customWhere>, User[]>> = true;

// --- negatives: wrong input must not compile ---

// @ts-expect-error - select values must be boolean or a nested spec, not a string
new QueryBuilder(userDelegate).select({ id: 'yes' });

// @ts-expect-error - include values must be boolean or a nested spec, not a number
new QueryBuilder(userDelegate).include({ posts: 1 });

// --- cross-kind custom() calls follow the runtime: a held select beats a later include ---

const _selectThenInclude = new QueryBuilder(userDelegate)
  .custom({ select: { id: true } })
  .custom({ include: { posts: true } })
  .execute();
const _24: Expect<Equal<Awaited<typeof _selectThenInclude>, { id: string }[]>> = true;

// ...and a later select replaces a held include
const _includeThenSelect = new QueryBuilder(userDelegate)
  .custom({ include: { posts: true } })
  .custom({ select: { id: true } })
  .execute();
const _25: Expect<Equal<Awaited<typeof _includeThenSelect>, { id: string }[]>> = true;

// an undefined/null projection changes nothing
declare const maybeSelect: { id: true } | undefined;
const _undefinedSelect = new QueryBuilder(userDelegate)
  .custom({ select: { email: true } })
  .custom({ select: undefined })
  .execute();
const _26: Expect<Equal<Awaited<typeof _undefinedSelect>, { email: string }[]>> = true;
const _maybe = new QueryBuilder(userDelegate).custom({ select: maybeSelect }).execute();
const _27: Expect<Equal<Awaited<typeof _maybe>, { id: string }[]>> = true;
