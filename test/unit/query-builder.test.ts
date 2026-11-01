import { afterEach, describe, expect, it } from 'vitest';
import { QueryBuilder } from '../../src/core/query-builder';
import { registerDialect, resetDialectConfig } from '../../src/dialects/registry';
import type { Dialect } from '../../src/dialects/capabilities';
import { createFakeDelegate, fakeRows } from '../helpers/fake-delegate';

afterEach(() => resetDialectConfig());

describe('QueryBuilder conditions', () => {
  it('search adds OR contains WITHOUT mode on the universal dialect', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .search({ searchText: 'jo', fields: ['email', 'id'] })
      .execute();
    const where = recorded.findManyArgs?.where as Record<string, any>;
    const clause = where.OR[0].email;
    expect(clause).toEqual({ contains: 'jo' });
    expect(clause.mode).toBeUndefined();
  });

  it('search adds mode insensitive for postgres', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'postgresql' })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    const where = recorded.findManyArgs?.where as Record<string, any>;
    expect(where.OR[0].email).toEqual({ contains: 'jo', mode: 'insensitive' });
  });

  it('search never emits mode for mysql (would throw on MySQL)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'mysql' })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    const where = recorded.findManyArgs?.where as Record<string, any>;
    expect(where.OR[0].email).toEqual({ contains: 'jo' });
  });

  it('registerDialect changes search output without core changes (coverage gap 7)', async () => {
    registerDialect('futuredb', { caseInsensitiveMode: true, caseInsensitiveCollation: false });
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'futuredb' as Dialect })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    const where = recorded.findManyArgs?.where as Record<string, any>;
    expect(where.OR[0].email).toEqual({ contains: 'jo', mode: 'insensitive' });
  });

  it('filter strips undefined values', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(2));
    await new QueryBuilder(delegate).filter({ status: 'ACTIVE', email: undefined }).execute();
    expect(recorded.findManyArgs?.where).toEqual({ status: 'ACTIVE' });
  });

  it('range with dot path expands nested', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(2));
    await new QueryBuilder(delegate).range({ 'avatar.size': { from: 5 } }).execute();
    expect(recorded.findManyArgs?.where).toEqual({ avatar: { size: { gte: 5 } } });
  });

  it('range adds nothing for a dangerous path', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(2));
    await new QueryBuilder(delegate)
      .range({ 'a.__proto__.size': { from: 5 } })
      .filter({ status: 'ACTIVE' })
      .execute();
    expect(recorded.findManyArgs?.where).toEqual({ status: 'ACTIVE' });
  });

  it('seeded initialArgs where is ANDed first', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(2));
    await new QueryBuilder(delegate, { initialArgs: { where: { deletedAt: null } } })
      .filter({ status: 'ACTIVE' })
      .execute();
    expect(recorded.findManyArgs?.where).toEqual({
      AND: [{ deletedAt: null }, { status: 'ACTIVE' }],
    });
  });
});

describe('QueryBuilder search robustness', () => {
  it('OR arms do not share one match object reference', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .search({ searchText: 'jo', fields: ['email', 'id'] })
      .execute();
    const where = recorded.findManyArgs?.where as Record<string, any>;
    expect(where.OR[0].email).not.toBe(where.OR[1].id);
  });

  it('whitespace-only searchText adds no condition', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).search({ searchText: '   ', fields: ['email'] }).execute();
    expect(recorded.findManyArgs?.where).toBeUndefined();
  });
});

describe('QueryBuilder custom where merge', () => {
  it('custom where is ANDed with the initialArgs seed, never replaces it', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { initialArgs: { where: { deletedAt: null } } })
      .custom({ where: { role: 'ADMIN' } })
      .execute();
    expect(recorded.findManyArgs?.where).toEqual({
      AND: [{ deletedAt: null }, { role: 'ADMIN' }],
    });
  });

  it('custom where without a seed stays unwrapped', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).custom({ where: { role: 'ADMIN' } }).execute();
    expect(recorded.findManyArgs?.where).toEqual({ role: 'ADMIN' });
  });

  it('successive custom wheres AND together', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .custom({ where: { role: 'ADMIN' } })
      .custom({ where: { status: 'ACTIVE' } })
      .execute();
    expect(recorded.findManyArgs?.where).toEqual({
      AND: [{ role: 'ADMIN' }, { status: 'ACTIVE' }],
    });
  });

  it('seed survives when custom also carries other args', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { initialArgs: { where: { deletedAt: null } } })
      .custom({ distinct: ['email'], where: { role: 'ADMIN' } })
      .execute();
    expect(recorded.findManyArgs?.distinct).toEqual(['email']);
    expect(recorded.findManyArgs?.where).toEqual({
      AND: [{ deletedAt: null }, { role: 'ADMIN' }],
    });
  });
});

describe('QueryBuilder custom undefined strip', () => {
  it('custom({ distinct: undefined }) does not overwrite an earlier distinct', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .custom({ distinct: ['email'] })
      .custom({ distinct: undefined })
      .execute();
    expect(recorded.findManyArgs?.distinct).toEqual(['email']);
  });

  it('strips nested undefined values in custom args', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).custom({ cursor: { id: 'u1', extra: undefined } }).execute();
    expect(recorded.findManyArgs?.cursor).toEqual({ id: 'u1' });
  });

  it('a custom where that is empty after stripping adds no condition', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .custom({ where: { a: undefined } as Record<string, unknown> })
      .execute();
    expect(recorded.findManyArgs?.where).toBeUndefined();
  });
});

describe('QueryBuilder sorting', () => {
  it('sortBy expands dot paths into nested orderBy', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'avatar.size', sortOrder: 'asc' }).execute();
    expect(recorded.findManyArgs?.orderBy).toEqual({ avatar: { size: 'asc' } });
  });

  it('sortBy keeps flat keys flat', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'createdAt' }).execute();
    expect(recorded.findManyArgs?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('sortBy adds nothing for a dangerous path', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'a.__proto__.b' }).execute();
    expect(recorded.findManyArgs?.orderBy).toBeUndefined();
  });

  it('orderBy sends multi-key orderBy verbatim', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).orderBy([{ id: 'asc' }, { email: 'desc' }]).execute();
    expect(recorded.findManyArgs?.orderBy).toEqual([{ id: 'asc' }, { email: 'desc' }]);
  });
});

describe('QueryBuilder offset pagination', () => {
  it('paginate computes skip/take', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(20));
    await new QueryBuilder(delegate).paginate({ page: 3, limit: 5 }).execute();
    expect(recorded.findManyArgs?.skip).toBe(10);
    expect(recorded.findManyArgs?.take).toBe(5);
  });

  it('no paginate means no skip/take', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(1));
    await new QueryBuilder(delegate).execute();
    expect(recorded.findManyArgs?.skip).toBeUndefined();
    expect(recorded.findManyArgs?.take).toBeUndefined();
  });

  it('executeWithMeta returns meta matching the data', async () => {
    const { delegate } = createFakeDelegate(fakeRows(40));
    const { meta, data } = await new QueryBuilder(delegate)
      .paginate({ page: 2, limit: 15 })
      .executeWithMeta();
    expect(meta).toEqual({ page: 2, limit: 15, total: 40, totalPage: 3 });
    expect(data).toHaveLength(15);
  });

  it('executeWithMeta defaults to page 1 limit 10 when unpaginated', async () => {
    const { delegate } = createFakeDelegate(fakeRows(40));
    const { meta, data } = await new QueryBuilder(delegate).executeWithMeta();
    expect(meta).toEqual({ page: 1, limit: 10, total: 40, totalPage: 4 });
    expect(data).toHaveLength(10);
  });

  it('executeWithMeta throws under cursor mode and never calls the delegate', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate).cursorPaginate({ limit: 3 }).executeWithMeta(),
    ).rejects.toThrow('executeWithMeta() is offset-mode only');
    expect(recorded.findManyArgs).toBeUndefined();
    expect(recorded.countArgs).toBeUndefined();
  });

  it('includeTotal: false skips the COUNT query', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(40));
    const { meta, data } = await new QueryBuilder(delegate).executeWithMeta({
      includeTotal: false,
    });
    expect(recorded.countArgs).toBeUndefined();
    expect(meta).toEqual({ page: 1, limit: 10, total: null, totalPage: null });
    expect(data).toHaveLength(10);
  });
});

describe('QueryBuilder strictNumbers', () => {
  it('throws on out-of-range limit when enabled', () => {
    const { delegate } = createFakeDelegate(fakeRows(3));
    expect(() =>
      new QueryBuilder(delegate, { strictNumbers: true }).paginate({ limit: 5000 }),
    ).toThrow('strictNumbers');
    expect(() =>
      new QueryBuilder(delegate, { strictNumbers: true }).paginate({ limit: 0 }),
    ).toThrow('strictNumbers');
    expect(() =>
      new QueryBuilder(delegate, { strictNumbers: true }).cursorPaginate({ limit: 2000 }),
    ).toThrow('strictNumbers');
    expect(() => new QueryBuilder(delegate, { strictNumbers: true }).paginate({ page: 0 })).toThrow(
      'strictNumbers',
    );
  });

  it('still clamps silently by default', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).paginate({ limit: 5000 }).execute();
    expect(recorded.findManyArgs?.take).toBe(1000);
  });

  it('throws when the computed skip exceeds the cap', async () => {
    const { delegate } = createFakeDelegate(fakeRows(3));
    await expect(
      new QueryBuilder(delegate, { strictNumbers: true })
        .paginate({ page: 1e9, limit: 1000 })
        .execute(),
    ).rejects.toThrow('skip');
  });

  it('serves an empty page beyond the skip cap and keeps meta.page truthful', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    const { data, meta } = await new QueryBuilder(delegate)
      .paginate({ page: 1e9, limit: 1000 })
      .executeWithMeta();
    expect(recorded.findManyArgs?.take).toBe(0);
    expect(data).toEqual([]);
    expect(meta.page).toBe(1e9);
    expect(meta.limit).toBe(1000);
    expect(meta.total).toBe(3);
  });

  it('throws the skip cap before the COUNT fires', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await expect(
      new QueryBuilder(delegate, { strictNumbers: true })
        .paginate({ page: 1e9, limit: 1000 })
        .executeWithMeta(),
    ).rejects.toThrow('skip');
    expect(recorded.countArgs).toBeUndefined();
  });
});

describe('QueryBuilder cursor pagination', () => {
  it('cursorPaginate wins over paginate', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate)
      .paginate({ page: 2, limit: 5 })
      .cursorPaginate({ limit: 7 })
      .execute();
    expect(recorded.findManyArgs?.take).toBe(8);
    expect(recorded.findManyArgs?.skip).toBeUndefined();
  });

  it('executeWithCursor over-fetches and reports next page', async () => {
    const { delegate } = createFakeDelegate(fakeRows(25));
    const { data, meta } = await new QueryBuilder(delegate)
      .sortBy({ sortBy: 'id' })
      .cursorPaginate({ limit: 20 })
      .executeWithCursor();
    expect(data).toHaveLength(20);
    expect(meta.hasNextPage).toBe(true);
    expect(meta.nextCursor).toBe('u19');
    expect(meta.hasPrevPage).toBe(false);
  });

  it('backward direction sends negative take with cursor', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u25', direction: 'backward', limit: 10 })
      .execute();
    expect(recorded.findManyArgs?.take).toBe(-11);
    expect(recorded.findManyArgs?.cursor).toEqual({ id: 'u25' });
    expect(recorded.findManyArgs?.skip).toBe(1);
  });

  it('backward page returns the rows just before the cursor, in sort order', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    const { data, meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u25', direction: 'backward', limit: 10 })
      .executeWithCursor();
    expect(data.map((r) => r.id)).toEqual([
      'u15',
      'u16',
      'u17',
      'u18',
      'u19',
      'u20',
      'u21',
      'u22',
      'u23',
      'u24',
    ]);
    expect(meta.hasPrevPage).toBe(true);
    expect(meta.prevCursor).toBe('u15');
    expect(meta.nextCursor).toBe('u24');
  });

  it('backward page near the start has no previous page', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    const { data, meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u4', direction: 'backward', limit: 10 })
      .executeWithCursor();
    expect(data.map((r) => r.id)).toEqual(['u0', 'u1', 'u2', 'u3']);
    expect(meta.hasPrevPage).toBe(false);
    expect(meta.prevCursor).toBeNull();
  });

  it('walking forward then backward revisits the same page', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    const page1 = await new QueryBuilder(delegate)
      .cursorPaginate({ limit: 10 })
      .executeWithCursor();
    const page2 = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: page1.meta.nextCursor ?? undefined, limit: 10 })
      .executeWithCursor();
    const back = await new QueryBuilder(delegate)
      .cursorPaginate({
        cursor: page2.meta.prevCursor ?? undefined,
        limit: 10,
        direction: 'backward',
      })
      .executeWithCursor();
    expect(back.data.map((r) => r.id)).toEqual(page1.data.map((r) => r.id));
  });

  it('next cursor round-trips to the following page without overlap', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    const page1 = await new QueryBuilder(delegate)
      .cursorPaginate({ limit: 10 })
      .executeWithCursor();
    expect(page1.meta.nextCursor).toBe('u9');
    expect(page1.data[9]?.id).toBe('u9');
    const page2 = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: page1.meta.nextCursor ?? undefined, limit: 10 })
      .executeWithCursor();
    expect(page2.data[0]?.id).toBe('u10');
    expect(page2.meta.hasPrevPage).toBe(true);
  });

  it('throws when the select drops the cursorField', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate)
        .select({ id: true })
        .cursorPaginate({ cursorField: 'email' })
        .executeWithCursor(),
    ).rejects.toThrow('projection drops cursorField');
  });

  it('passes when the select keeps the cursorField', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    const { data } = await new QueryBuilder(delegate)
      .select({ id: true, email: true })
      .cursorPaginate({ cursorField: 'email' })
      .executeWithCursor();
    expect(data).toHaveLength(5);
  });

  it('also guards a select supplied via custom()', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate)
        .custom({ select: { id: true } })
        .cursorPaginate({ cursorField: 'email' })
        .executeWithCursor(),
    ).rejects.toThrow('projection drops cursorField');
  });

  it('strict mode makes hasPrevPage exact when the cursor sits on the first row', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    const { meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u0', limit: 5, strict: true })
      .executeWithCursor();
    expect(meta.hasPrevPage).toBe(false); // the optimistic path would claim true
    expect(meta.hasNextPage).toBe(true);
    const probe = recorded.findManyCalls[1];
    expect(probe?.take).toBe(-1);
    expect(probe?.cursor).toEqual({ id: 'u0' });
    expect(probe?.skip).toBe(1);
  });

  it('strict probe mirrors the query where and orderBy', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate)
      .filter({ status: 'ACTIVE' })
      .sortBy({ sortBy: 'id', sortOrder: 'asc' })
      .cursorPaginate({ cursor: 'u0', limit: 5, strict: true })
      .executeWithCursor();
    const probe = recorded.findManyCalls[1];
    expect(probe?.where).toEqual({ status: 'ACTIVE' });
    expect(probe?.orderBy).toEqual({ id: 'asc' });
    expect(probe?.take).toBe(-1);
  });

  it('strict mode makes hasNextPage exact on an empty backward page', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    const { data, meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u0', limit: 5, direction: 'backward', strict: true })
      .executeWithCursor();
    expect(data).toHaveLength(0); // nothing before u0
    expect(meta.hasNextPage).toBe(true); // u0 itself exists — exact, not optimistic false
    expect(recorded.findManyCalls[1]?.take).toBe(1);
  });

  it('cursorType defaults to string: the cursor is passed through unchanged', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30, 'number'));
    await new QueryBuilder(delegate).cursorPaginate({ cursor: 5, limit: 3 }).execute();
    expect(recorded.findManyArgs?.cursor).toEqual({ id: 5 });
  });

  it('a string cursor for an Int column is rejected (the problem cursorType solves)', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30, 'number'));
    await expect(
      new QueryBuilder(delegate).cursorPaginate({ cursor: '5', limit: 3 }).executeWithCursor(),
    ).rejects.toThrow('Expected number, provided string');
  });

  it("cursorType 'number' round-trips a numeric id through nextCursor", async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30, 'number'));
    const page1 = await new QueryBuilder(delegate)
      .cursorPaginate({ limit: 10 })
      .executeWithCursor();
    expect(page1.data.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page1.meta.nextCursor).toBe('10');

    const page2 = await new QueryBuilder(delegate)
      .cursorPaginate({
        cursor: page1.meta.nextCursor ?? undefined,
        cursorType: 'number',
        limit: 10,
      })
      .executeWithCursor();
    expect(recorded.findManyArgs?.cursor).toEqual({ id: 10 });
    expect(page2.data.map((r) => r.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(page2.meta.prevCursor).toBe('11');

    const back = await new QueryBuilder(delegate)
      .cursorPaginate({
        cursor: page2.meta.prevCursor ?? undefined,
        cursorType: 'number',
        direction: 'backward',
        limit: 10,
      })
      .executeWithCursor();
    expect(back.data.map((r) => r.id)).toEqual(page1.data.map((r) => r.id));
  });

  it("cursorType 'bigint' coerces to a bigint cursor", async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30, 'bigint'));
    const { data, meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: '5', cursorType: 'bigint', limit: 2 })
      .executeWithCursor();
    expect(recorded.findManyArgs?.cursor).toEqual({ id: 5n });
    expect(data.map((r) => r.id)).toEqual([6n, 7n]);
    expect(meta.nextCursor).toBe('7');
  });

  it("cursorType 'date' turns the ISO cursor string back into a Date", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      ...fakeRows(6)[i]!,
      createdAt: new Date(Date.UTC(2026, 0, i + 1)),
    }));
    const { delegate, recorded } = createFakeDelegate(rows);
    const page1 = await new QueryBuilder(delegate)
      .cursorPaginate({ cursorField: 'createdAt', limit: 2 })
      .executeWithCursor();
    expect(page1.meta.nextCursor).toBe('2026-01-02T00:00:00.000Z');
    const page2 = await new QueryBuilder(delegate)
      .cursorPaginate({
        cursorField: 'createdAt',
        cursor: page1.meta.nextCursor ?? undefined,
        cursorType: 'date',
        limit: 2,
      })
      .executeWithCursor();
    expect(recorded.findManyArgs?.cursor).toEqual({
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(page2.data.map((r) => r.id)).toEqual(['u2', 'u3']);
  });

  it('strict probe uses the coerced cursor too', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30, 'number'));
    await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: '5', cursorType: 'number', limit: 2, strict: true })
      .executeWithCursor();
    expect(recorded.findManyCalls[1]?.cursor).toEqual({ id: 5 });
  });

  it('an invalid cursor throws at cursorPaginate(), before any query is sent', () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3, 'number'));
    expect(() =>
      new QueryBuilder(delegate).cursorPaginate({ cursor: 'abc', cursorType: 'number' }),
    ).toThrow('"abc"');
    expect(recorded.findManyCalls).toHaveLength(0);
  });

  it('throws when a custom() omit drops the cursor field', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate).custom({ omit: { id: true } }).executeWithCursor(),
    ).rejects.toThrow('cursorField "id"');
  });

  it('throws instead of emitting a bogus cursor for an unknown cursorField', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    await expect(
      new QueryBuilder(delegate)
        .cursorPaginate({ cursorField: 'nope', limit: 5 })
        .executeWithCursor(),
    ).rejects.toThrow('cursorField "nope"');
  });

  it('strict probe inherits seeded orderBy, distinct and where from the main query', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate, { initialArgs: { orderBy: { email: 'desc' } } })
      .filter({ status: 'ACTIVE' })
      .custom({ distinct: ['email'] })
      .cursorPaginate({ cursor: 'u5', limit: 3, strict: true })
      .executeWithCursor();
    const probe = recorded.findManyCalls[1];
    expect(probe?.orderBy).toEqual({ email: 'desc' });
    expect(probe?.distinct).toEqual(['email']);
    expect(probe?.where).toEqual({ status: 'ACTIVE' });
    expect(probe?.take).toBe(-1);
    expect(probe?.cursor).toEqual({ id: 'u5' });
    expect(probe?.skip).toBe(1);
  });

  it('strict probe fetches only the cursor field, never a projection or include', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate)
      .include({ posts: true })
      .cursorPaginate({ cursor: 'u5', limit: 3, strict: true })
      .executeWithCursor();
    const probe = recorded.findManyCalls[1];
    expect(probe?.select).toEqual({ id: true });
    expect(probe?.include).toBeUndefined();
  });

  it('strict probe and main query run concurrently', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    let inFlight = 0;
    let maxInFlight = 0;
    const slow = {
      findMany: async (args?: Parameters<typeof delegate.findMany>[0]) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Yield so a second call can start before this one settles (no timers: no Node typings).
        await Promise.resolve();
        await Promise.resolve();
        try {
          return await delegate.findMany(args);
        } finally {
          inFlight -= 1;
        }
      },
      count: delegate.count,
    };
    await new QueryBuilder(slow)
      .cursorPaginate({ cursor: 'u5', limit: 3, strict: true })
      .executeWithCursor();
    expect(maxInFlight).toBe(2);
  });

  it('custom cursor/skip do not leak into cursor mode when no cursor was given', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate)
      .custom({ cursor: { id: 'u9' }, skip: 4 })
      .cursorPaginate({ limit: 3 })
      .execute();
    expect(recorded.findManyArgs?.cursor).toBeUndefined();
    expect(recorded.findManyArgs?.skip).toBeUndefined();
  });

  it('no probe query without strict', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate).cursorPaginate({ cursor: 'u0', limit: 5 }).executeWithCursor();
    expect(recorded.findManyCalls).toHaveLength(1);
  });
});

describe('QueryBuilder extras', () => {
  it('custom merges raw args', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).custom({ distinct: ['email'] }).execute();
    expect(recorded.findManyArgs?.distinct).toEqual(['email']);
  });

  it('select and include are mutually exclusive (select wins last)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).include({ posts: true }).select({ id: true }).execute();
    expect(recorded.findManyArgs?.select).toEqual({ id: true });
    expect(recorded.findManyArgs?.include).toBeUndefined();
  });

  it('select() beats a seeded include: never both in one query', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { initialArgs: { include: { posts: true } } })
      .select({ id: true })
      .execute();
    expect(recorded.findManyArgs?.select).toEqual({ id: true });
    expect(recorded.findManyArgs?.include).toBeUndefined();
  });

  it('include() beats a seeded select: never both in one query', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { initialArgs: { select: { id: true } } })
      .include({ posts: true })
      .execute();
    expect(recorded.findManyArgs?.include).toEqual({ posts: true });
    expect(recorded.findManyArgs?.select).toBeUndefined();
  });

  it('explicit select() wins over custom() regardless of call order', async () => {
    const a = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(a.delegate)
      .select({ id: true })
      .custom({ include: { posts: true }, select: { email: true } })
      .execute();
    const b = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(b.delegate)
      .custom({ include: { posts: true }, select: { email: true } })
      .select({ id: true })
      .execute();
    for (const { recorded } of [a, b]) {
      expect(recorded.findManyArgs?.select).toEqual({ id: true });
      expect(recorded.findManyArgs?.include).toBeUndefined();
    }
  });

  it('custom select then custom include: only the select reaches the delegate', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .custom({ select: { id: true } })
      .custom({ include: { posts: true } })
      .execute();
    expect(recorded.findManyArgs?.select).toEqual({ id: true });
    expect(recorded.findManyArgs?.include).toBeUndefined();
  });

  it('a custom() include is sent when nothing explicit was set', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).custom({ include: { posts: true } }).execute();
    expect(recorded.findManyArgs?.include).toEqual({ posts: true });
    expect(recorded.findManyArgs?.select).toBeUndefined();
  });

  it('a seeded select feeds the cursor field guard', async () => {
    const { delegate } = createFakeDelegate(fakeRows(3));
    await expect(
      new QueryBuilder(delegate, { initialArgs: { select: { email: true } } })
        .cursorPaginate({ limit: 2 })
        .executeWithCursor(),
    ).rejects.toThrow('cursorField');
  });

  it('an explicit include() lifts a seeded select that would trip the cursor guard', async () => {
    const { delegate } = createFakeDelegate(fakeRows(3));
    const result = await new QueryBuilder(delegate, {
      initialArgs: { select: { email: true } },
    })
      .include({ posts: true })
      .cursorPaginate({ limit: 2 })
      .executeWithCursor();
    expect(result.data).toHaveLength(2);
  });

  it('execute methods never change the builder: execute() after executeWithMeta() is unpaginated', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    const qb = new QueryBuilder(delegate);
    await qb.executeWithMeta();
    await qb.execute();
    expect(recorded.findManyArgs?.take).toBeUndefined();
    expect(recorded.findManyArgs?.skip).toBeUndefined();
  });

  it('executeWithCursor() does not switch the builder into cursor mode', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    const qb = new QueryBuilder(delegate);
    await qb.executeWithCursor();
    const { meta } = await qb.executeWithMeta();
    expect(meta.page).toBe(1);
    expect(recorded.findManyArgs?.take).toBe(10);
    expect(recorded.findManyArgs?.skip).toBe(0);
  });

  it('executeWithCursor() falls back to the paginate() limit', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(60));
    const { data, meta } = await new QueryBuilder(delegate)
      .paginate({ limit: 25 })
      .executeWithCursor();
    expect(recorded.findManyArgs?.take).toBe(26);
    expect(data).toHaveLength(25);
    expect(meta.limit).toBe(25);
  });

  it('paginate().first() returns the global first row', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(20));
    const row = await new QueryBuilder(delegate).paginate({ page: 3, limit: 5 }).first();
    expect(recorded.findManyArgs?.take).toBe(1);
    expect(recorded.findManyArgs?.skip).toBeUndefined();
    expect(row?.id).toBe('u0');
  });

  it('firstOrThrow throws NoResultError on empty results', async () => {
    const { delegate } = createFakeDelegate([]);
    await expect(new QueryBuilder(delegate).firstOrThrow()).rejects.toThrow(
      'Query returned no rows',
    );
  });

  it('count ignores pagination', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(7));
    const total = await new QueryBuilder(delegate).paginate({ page: 2, limit: 3 }).count();
    expect(total).toBe(7);
    expect(recorded.countArgs?.take).toBeUndefined();
  });
});
