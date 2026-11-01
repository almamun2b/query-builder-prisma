import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
  coerceCursor,
  buildPaginationMeta,
  clampLimit,
  serializeCursorValue,
  toCursorArgs,
  toOffsetArgs,
  MAX_SKIP,
} from '../../src/core/pagination';

describe('clampLimit', () => {
  it('clamps to [1, 1000]', () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(5000)).toBe(1000);
    expect(clampLimit(25)).toBe(25);
  });
  it('defaults non-finite to 10', () => {
    expect(clampLimit(Number.NaN)).toBe(10);
  });
});

describe('toOffsetArgs', () => {
  it('computes skip/take', () => {
    expect(toOffsetArgs(3, 25)).toEqual({ take: 25, skip: 50, page: 3, limit: 25 });
  });
  it('clamps bad input', () => {
    const args = toOffsetArgs(-2, 0);
    expect(args.page).toBe(1);
    expect(args.limit).toBe(1);
  });
  it('serves an empty page (take 0) instead of a different page once skip passes MAX_SKIP', () => {
    expect(MAX_SKIP).toBe(100_000);
    const beyond = toOffsetArgs(1e9, 1000);
    expect(beyond.take).toBe(0);
    expect(beyond.skip).toBe(MAX_SKIP);
    expect(beyond.page).toBe(1e9);
    expect(beyond.limit).toBe(1000);
  });
  it('a skip exactly at MAX_SKIP is still served', () => {
    expect(toOffsetArgs(101, 1000)).toEqual({ take: 1000, skip: 100_000, page: 101, limit: 1000 });
    expect(toOffsetArgs(102, 1000).take).toBe(0);
  });
});

describe('buildPaginationMeta', () => {
  it('computes totalPage', () => {
    expect(buildPaginationMeta(95, 2, 10)).toEqual({
      page: 2,
      limit: 10,
      total: 95,
      totalPage: 10,
    });
  });
});

describe('serializeCursorValue', () => {
  it('serializes Dates as ISO-8601 and round-trips', () => {
    const date = new Date('2026-01-01T06:00:09.000Z');
    const cursor = serializeCursorValue(date);
    expect(cursor).toBe('2026-01-01T06:00:09.000Z');
    expect(new Date(cursor).getTime()).toBe(date.getTime());
  });
  it('falls back to plain string coercion', () => {
    expect(serializeCursorValue(42)).toBe('42');
    expect(serializeCursorValue('u9')).toBe('u9');
  });
});

describe('toCursorArgs', () => {
  it('over-fetches one row forward', () => {
    expect(toCursorArgs({ cursorField: 'id', limit: 10 })).toEqual({ take: 11 });
  });
  it('negative take walks backward', () => {
    expect(toCursorArgs({ cursorField: 'id', limit: 10, direction: 'backward' }).take).toBe(-11);
  });
  it('sets cursor + skip 1 when a cursor is given', () => {
    expect(toCursorArgs({ cursorField: 'id', cursor: 'u9', limit: 5 })).toEqual({
      take: 6,
      cursor: { id: 'u9' },
      skip: 1,
    });
  });
  it('passes number and Date cursors through raw', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    expect(toCursorArgs({ cursorField: 'n', cursor: 7 }).cursor).toEqual({ n: 7 });
    expect(toCursorArgs({ cursorField: 'at', cursor: date }).cursor).toEqual({ at: date });
  });
});

describe('buildCursorPage', () => {
  const mk = (i: number) => ({ id: `u${i}` });

  it('forward: slices the page, detects next, null prev on first page', () => {
    const rows = Array.from({ length: 12 }, (_, i) => mk(i));
    const { data, meta } = buildCursorPage(rows, {
      limit: 10,
      direction: 'forward',
      cursorField: 'id',
      hadCursor: false,
    });
    expect(data).toHaveLength(10);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.hasPrevPage).toBe(false);
    expect(meta.nextCursor).toBe('u9');
    expect(meta.prevCursor).toBeNull();
  });

  it('backward: Prisma returns negative-take rows in sort order, over-fetch row first', () => {
    // Verified against a real Prisma client: take -3 with a cursor at u21 returns
    // [u18, u19, u20] - ascending, the extra row (u18) is the farthest from the cursor.
    const rows = [mk(18), mk(19), mk(20)];
    const { data, meta } = buildCursorPage(rows, {
      limit: 2,
      direction: 'backward',
      cursorField: 'id',
      hadCursor: true,
    });
    expect(data.map((r) => r.id)).toEqual(['u19', 'u20']);
    expect(meta.hasPrevPage).toBe(true);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.prevCursor).toBe('u19');
    expect(meta.nextCursor).toBe('u20');
  });

  it('backward without an extra row returns every row unchanged, no previous page', () => {
    const rows = [mk(19), mk(20)];
    const { data, meta } = buildCursorPage(rows, {
      limit: 2,
      direction: 'backward',
      cursorField: 'id',
      hadCursor: true,
    });
    expect(data.map((r) => r.id)).toEqual(['u19', 'u20']);
    expect(meta.hasPrevPage).toBe(false);
  });

  it('no extra rows means no next page', () => {
    const rows = [mk(1), mk(2)];
    const { meta } = buildCursorPage(rows, {
      limit: 10,
      direction: 'forward',
      cursorField: 'id',
      hadCursor: true,
    });
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(true);
  });

  it('serializes Date cursor fields to ISO strings', () => {
    const rows = [
      { id: 'a', at: new Date('2026-01-01T06:00:09.000Z') },
      { id: 'b', at: new Date('2026-02-01T06:00:09.000Z') },
    ];
    const { meta } = buildCursorPage(rows, {
      limit: 1,
      direction: 'forward',
      cursorField: 'at',
      hadCursor: false,
    });
    expect(meta.hasNextPage).toBe(true);
    expect(meta.nextCursor).toBe('2026-01-01T06:00:09.000Z');
  });

  it('a probe-derived flag overrides the optimistic one', () => {
    const rows = [mk(1), mk(2)];
    const { meta } = buildCursorPage(rows, {
      limit: 10,
      direction: 'forward',
      cursorField: 'id',
      hadCursor: true,
      exactFlags: { hasPrevPage: false },
    });
    expect(meta.hasPrevPage).toBe(false);
    expect(meta.hasNextPage).toBe(false);
  });

  it('fixes the empty-page hasPrevPage edge', () => {
    const { meta } = buildCursorPage([], {
      limit: 10,
      direction: 'forward',
      cursorField: 'id',
      hadCursor: true,
      exactFlags: { hasPrevPage: true },
    });
    expect(meta.hasPrevPage).toBe(true);
  });
});

describe('buildCursorPage cursor value validation', () => {
  const info = {
    limit: 1,
    direction: 'forward' as const,
    cursorField: 'id',
    hadCursor: false,
  };

  it('throws a descriptive error when the edge row lacks the cursor field', () => {
    expect(() => buildCursorPage([{ other: 1 }, { other: 2 }], info)).toThrow('cursorField "id"');
  });

  it('throws when the cursor field is null', () => {
    expect(() => buildCursorPage([{ id: null }, { id: 'b' }], info)).toThrow('cursorField "id"');
  });

  it('throws a descriptive error for an Invalid Date instead of a bare RangeError', () => {
    const rows = [{ id: new Date('nope') }, { id: new Date('2026-01-01') }];
    expect(() => buildCursorPage(rows, info)).toThrow('Invalid Date');
  });

  it('does not require the field when no cursor is derived', () => {
    const { meta } = buildCursorPage([{ other: 1 }], info);
    expect(meta.nextCursor).toBeNull();
  });
});

describe('coerceCursor', () => {
  it("'string' (the default) passes any value through untouched", () => {
    expect(coerceCursor(5, 'string')).toBe(5);
    expect(coerceCursor('u9', 'string')).toBe('u9');
    const date = new Date('2026-01-01');
    expect(coerceCursor(date, 'string')).toBe(date);
    expect(coerceCursor(undefined, 'number')).toBeUndefined();
  });

  it("'number' parses a cursor string from a query string", () => {
    expect(coerceCursor('42', 'number')).toBe(42);
    expect(coerceCursor(' 7 ', 'number')).toBe(7);
    expect(coerceCursor(3.5, 'number')).toBe(3.5);
  });

  it("'number' rejects non-numeric input with a message naming the value", () => {
    expect(() => coerceCursor('abc', 'number')).toThrow('"abc"');
    expect(() => coerceCursor('', 'number')).toThrow('number');
    expect(() => coerceCursor(Number.NaN, 'number')).toThrow('number');
    expect(() => coerceCursor('Infinity', 'number')).toThrow('number');
  });

  it("'bigint' parses decimal strings and integers", () => {
    expect(coerceCursor('9007199254740993', 'bigint')).toBe(9007199254740993n);
    expect(coerceCursor(12n, 'bigint')).toBe(12n);
    expect(coerceCursor(8, 'bigint')).toBe(8n);
  });

  it("'bigint' rejects anything that is not an integer", () => {
    expect(() => coerceCursor('x1', 'bigint')).toThrow('bigint');
    expect(() => coerceCursor('1.5', 'bigint')).toThrow('bigint');
    expect(() => coerceCursor(1.5, 'bigint')).toThrow('bigint');
  });

  it("'date' parses ISO strings and timestamps, keeps valid Dates", () => {
    const iso = '2026-01-01T06:00:09.000Z';
    expect(coerceCursor(iso, 'date')).toEqual(new Date(iso));
    expect(coerceCursor(Date.parse(iso), 'date')).toEqual(new Date(iso));
    const date = new Date(iso);
    expect(coerceCursor(date, 'date')).toBe(date);
  });

  it("'date' rejects unparsable input", () => {
    expect(() => coerceCursor('nope', 'date')).toThrow('"nope"');
    expect(() => coerceCursor(new Date('nope'), 'date')).toThrow('date');
  });
});

describe('serializeCursorValue for bigint', () => {
  it('serializes bigint to its decimal string', () => {
    expect(serializeCursorValue(9007199254740993n)).toBe('9007199254740993');
  });
});
