import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { PaginationMeta, PaginationMetaNoTotal } from '../../src/types/public';
import type { Equal, Expect } from './helpers';

interface User {
  id: string;
  email: string;
}

interface UserFindArgs {
  where?: Record<string, unknown>;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[];
  skip?: number;
  take?: number;
}

interface UserDelegate extends PrismaModelDelegate {
  findMany: (args?: UserFindArgs) => Promise<User[]>;
  count: (args?: { where?: Record<string, unknown> }) => Promise<number>;
}

declare const userDelegate: UserDelegate;

// --- executeWithMeta meta types ---

// default call: meta keeps the exact PaginationMeta shape (no widening)
const _metaDefault = new QueryBuilder(userDelegate).executeWithMeta();
const _m1: Expect<Equal<Awaited<typeof _metaDefault>['meta'], PaginationMeta>> = true;

// includeTotal: false: meta is the no-total shape (total: null, not 0)
const _metaNoTotal = new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: false });
const _m2: Expect<Equal<Awaited<typeof _metaNoTotal>['meta'], PaginationMetaNoTotal>> = true;

// includeTotal: true stays PaginationMeta
const _metaTotal = new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: true });
const _m3: Expect<Equal<Awaited<typeof _metaTotal>['meta'], PaginationMeta>> = true;

// --- multi-key orderBy ---

// array orderBy is accepted verbatim from the derived OrderByOf
new QueryBuilder(userDelegate).orderBy([{ id: 'asc' }, { email: 'desc' }]);

// --- includeTotal given as a non-literal boolean: both shapes are possible ---

declare const maybeTotal: boolean;
const _metaMaybe = new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: maybeTotal });
const _m4: Expect<
  Equal<Awaited<typeof _metaMaybe>['meta'], PaginationMeta | PaginationMetaNoTotal>
> = true;

// an options object without includeTotal still yields the full meta
const _metaEmpty = new QueryBuilder(userDelegate).executeWithMeta({});
const _m5: Expect<Equal<Awaited<typeof _metaEmpty>['meta'], PaginationMeta>> = true;

// --- negatives: wrong input must not compile ---

// @ts-expect-error - includeTotal must be a boolean
new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: 'yes' });

// @ts-expect-error - sortOrder only accepts 'asc' | 'desc'
new QueryBuilder(userDelegate).sortBy({ sortBy: 'id', sortOrder: 'up' });

// cursorType accepts only the four documented kinds, and bigint cursors compile
new QueryBuilder(userDelegate).cursorPaginate({ cursor: '42', cursorType: 'number' });
new QueryBuilder(userDelegate).cursorPaginate({ cursor: 42n, cursorType: 'bigint' });

// a last page's `meta.nextCursor` (string | null) feeds straight back in
declare const nextCursor: string | null | undefined;
new QueryBuilder(userDelegate).cursorPaginate({ cursor: nextCursor });

// @ts-expect-error - unknown cursorType
new QueryBuilder(userDelegate).cursorPaginate({ cursor: '1', cursorType: 'uuid' });
