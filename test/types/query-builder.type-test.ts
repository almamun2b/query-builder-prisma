import { QueryBuilder } from '../../src/core/query-builder';
import type { PrismaModelDelegate } from '../../src/types/delegate';
import type { PaginationMeta, PaginationMetaNoTotal } from '../../src/types/public';

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

// --- strict type-equality helpers (verified by `npm run typecheck`) ---
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// --- executeWithMeta meta types (audit G3) ---

// default call: meta keeps the exact PaginationMeta shape (no widening)
const _metaDefault = new QueryBuilder(userDelegate).executeWithMeta();
const _m1: Expect<Equal<Awaited<typeof _metaDefault>['meta'], PaginationMeta>> = true;

// includeTotal: false: meta is the no-total shape (total: null, not 0)
const _metaNoTotal = new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: false });
const _m2: Expect<Equal<Awaited<typeof _metaNoTotal>['meta'], PaginationMetaNoTotal>> = true;

// includeTotal: true stays PaginationMeta
const _metaTotal = new QueryBuilder(userDelegate).executeWithMeta({ includeTotal: true });
const _m3: Expect<Equal<Awaited<typeof _metaTotal>['meta'], PaginationMeta>> = true;

// --- multi-key orderBy (audit G1) ---

// array orderBy is accepted verbatim from the derived OrderByOf
new QueryBuilder(userDelegate).orderBy([{ id: 'asc' }, { email: 'desc' }]);
