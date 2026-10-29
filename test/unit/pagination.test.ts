import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
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
  it('caps skip at MAX_SKIP (audit F18)', () => {
    expect(toOffsetArgs(1e9, 1000).skip).toBe(MAX_SKIP);
    expect(MAX_SKIP).toBe(100_000);
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

describe('serializeCursorValue (audit F4)', () => {
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
  it('passes number and Date cursors through raw (audit F4)', () => {
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

  it('backward: reverses rows so output stays in sort order', () => {
    const rows = [mk(20), mk(19), mk(18)];
    const { data, meta } = buildCursorPage(rows, {
      limit: 2,
      direction: 'backward',
      cursorField: 'id',
      hadCursor: true,
    });
    expect(data.map((r) => r.id)).toEqual(['u19', 'u20']);
    expect(meta.hasPrevPage).toBe(true);
    expect(meta.prevCursor).toBe('u19');
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

  it('serializes Date cursor fields to ISO strings (audit F4)', () => {
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

  it('a probe-derived flag overrides the optimistic one (audit F10)', () => {
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

  it('fixes the empty-page hasPrevPage edge (audit G9)', () => {
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
