import { describe, expect, it } from 'vitest';
import {
  buildCursorPage,
  buildPaginationMeta,
  clampLimit,
  toCursorArgs,
  toOffsetArgs,
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
});
