import { describe, expect, it } from 'vitest';
import { QueryBuilder } from '../../src/core/query-builder';
import { createFakeDelegate, fakeRows } from '../helpers/fake-delegate';

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

describe('QueryBuilder custom where merge (audit F2)', () => {
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

  it('executeWithMeta throws under cursor mode and never calls the delegate (audit F1)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate).cursorPaginate({ limit: 3 }).executeWithMeta(),
    ).rejects.toThrow('executeWithMeta() is offset-mode only');
    expect(recorded.findManyArgs).toBeUndefined();
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
});

describe('QueryBuilder extras', () => {
  it('custom merges raw args', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).custom({ distinct: ['email'] }).execute();
    expect(recorded.findManyArgs?.distinct).toEqual(['email']);
  });

  it('select and include are mutually exclusive (select wins last)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .include({ posts: true })
      .select({ id: true })
      .execute();
    expect(recorded.findManyArgs?.select).toEqual({ id: true });
    expect(recorded.findManyArgs?.include).toBeUndefined();
  });

  it('first returns the first row and forces take 1', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(5));
    const row = await new QueryBuilder(delegate).first();
    expect(recorded.findManyArgs?.take).toBe(1);
    expect(row).toEqual({ id: 'u0', email: 'e0@x.dev', status: 'ACTIVE' });
    const empty = createFakeDelegate([]);
    const none = await new QueryBuilder(empty.delegate).first();
    expect(none).toBeNull();
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
