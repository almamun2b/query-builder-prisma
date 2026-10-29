import type { PrismaModelDelegate, WhereKeyOf, WhereOf } from './delegate';

/** Sort direction accepted by Prisma's `orderBy`. */
export type SortOrder = 'asc' | 'desc';

/** Direction to walk through a cursor-paginated result set. */
export type CursorDirection = 'forward' | 'backward';

/** A single numeric/date/string bound used by `QueryBuilder.range()`. */
export type RangeBound = string | number | Date;

/** Open/closed bounds for one field path. Omitted bounds are skipped. */
export interface RangeInput {
  from?: RangeBound | undefined;
  to?: RangeBound | undefined;
}

/** Offset pagination metadata returned by `executeWithMeta()`. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
}

/**
 * Metadata shape when `executeWithMeta({ includeTotal: false })` skips the
 * `COUNT` query — the totals are unknown, not zero (audit G3).
 */
export interface PaginationMetaNoTotal {
  page: number;
  limit: number;
  total: null;
  totalPage: null;
}

/** Cursor pagination metadata returned by `executeWithCursor()`. */
export interface CursorMeta {
  limit: number;
  /** Cursor to pass as `cursor` to fetch the next page (`null` if none). */
  nextCursor: string | null;
  /** Cursor to pass as `cursor` (with `direction: 'backward'`) for the previous page. */
  prevCursor: string | null;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

/**
 * A partial `where` whose values may also be `undefined`, so optional query
 * params can be forwarded directly (they are stripped out at build time).
 */
export type FilterInput<D extends PrismaModelDelegate> = {
  [K in WhereKeyOf<D>]?: WhereOf<D>[K] | undefined;
};
