/**
 * Offset ("skip/take") and cursor ("seek") pagination math — pure functions,
 * fully unit-testable without any database.
 */
import type { CursorDirection, CursorMeta, PaginationMeta } from '../types/public';

export const DEFAULT_PAGE_SIZE = 10;
export const MAX_PAGE_SIZE = 1000;
/** Upper bound for offset `skip` so deep pages cannot hit the DB unbounded (audit F18). */
export const MAX_SKIP = 100_000;

/** Clamp a page size to `[1, MAX_PAGE_SIZE]`; non-finite input gets the default. */
export function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(Math.max(1, Math.floor(limit)), MAX_PAGE_SIZE);
}

/** Clamp a 1-based page number; `0`, negatives and NaN all become page 1. */
export function clampPage(page: number): number {
  if (!Number.isFinite(page)) {
    return 1;
  }
  return Math.max(1, Math.floor(page));
}

/** `skip`/`take` for a 1-based page + page size (both clamped, `skip` capped). */
export function toOffsetArgs(
  page: number,
  limit: number,
): { take: number; skip: number; page: number; limit: number } {
  const safePage = clampPage(page);
  const safeLimit = clampLimit(limit);
  const skip = Math.min((safePage - 1) * safeLimit, MAX_SKIP);
  return { take: safeLimit, skip, page: safePage, limit: safeLimit };
}

/** Offset pagination metadata for a known `total`. */
export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  const safeLimit = clampLimit(limit);
  const safePage = clampPage(page);
  return {
    page: safePage,
    limit: safeLimit,
    total,
    totalPage: Math.ceil(total / safeLimit),
  };
}

/**
 * Serialize one cursor value. Dates become ISO-8601 strings so cursors are
 * round-trippable and locale/TZ-independent (audit F4); everything else uses
 * plain string coercion.
 */
export function serializeCursorValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

/** Everything needed to turn cursor options into `findMany` args. */
export interface CursorPlan {
  cursor?: string | number | Date | undefined;
  limit?: number | undefined;
  direction?: CursorDirection;
  cursorField: string;
}

/**
 * `take`/`cursor`/`skip` for seek pagination:
 * - over-fetches one row (`±(limit + 1)`) to detect the next/previous page,
 * - negative `take` walks backwards,
 * - `skip: 1` excludes the cursor row itself.
 * The cursor value is passed through raw — Prisma accepts strings, numbers
 * and Dates for the cursor field.
 */
export function toCursorArgs(plan: CursorPlan): {
  take: number;
  cursor?: Record<string, unknown>;
  skip?: number;
} {
  const sign = plan.direction === 'backward' ? -1 : 1;
  const take = sign * (clampLimit(plan.limit ?? DEFAULT_PAGE_SIZE) + 1);
  if (plan.cursor === undefined) {
    return { take };
  }
  return {
    take,
    cursor: { [plan.cursorField]: plan.cursor },
    skip: 1,
  };
}

/** Exact edge flags from a strict-mode probe query (audit F10). */
export interface ExactCursorFlags {
  hasNextPage?: boolean | undefined;
  hasPrevPage?: boolean | undefined;
}

/** Inputs for interpreting an over-fetched cursor page. */
export interface CursorPageInfo {
  limit: number;
  direction: CursorDirection;
  cursorField: string;
  /** Whether a cursor was supplied (i.e. this is not the first page). */
  hadCursor: boolean;
  /**
   * Probe-derived flags (strict mode); each entry replaces the optimistic
   * approximation for that edge (audit F10 / G9).
   */
  exactFlags?: ExactCursorFlags | undefined;
}

/**
 * Slice an over-fetched result set into the page + cursor metadata. Rows are
 * always returned in the configured sort order regardless of `direction`.
 */
export function buildCursorPage<T extends Record<string, unknown>>(
  rows: T[],
  info: CursorPageInfo,
): { data: T[]; meta: CursorMeta } {
  const { limit, direction, cursorField, hadCursor, exactFlags } = info;
  const safeLimit = clampLimit(limit);

  const hasExtra = rows.length > safeLimit;
  const pageRows = hasExtra ? rows.slice(0, safeLimit) : rows;
  const ordered = direction === 'backward' ? [...pageRows].reverse() : pageRows;

  const hasRows = rows.length > 0;
  const hasNextPage =
    exactFlags?.hasNextPage ?? (direction === 'forward' ? hasExtra : hadCursor && hasRows);
  const hasPrevPage =
    exactFlags?.hasPrevPage ?? (direction === 'backward' ? hasExtra : hadCursor && hasRows);

  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  return {
    data: ordered,
    meta: {
      limit: safeLimit,
      nextCursor:
        hasNextPage && last !== undefined ? serializeCursorValue(last[cursorField]) : null,
      prevCursor:
        hasPrevPage && first !== undefined ? serializeCursorValue(first[cursorField]) : null,
      hasNextPage,
      hasPrevPage,
    },
  };
}
