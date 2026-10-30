import { afterEach, describe, expect, it } from 'vitest';
import { QueryBuilder } from '../../src/core/query-builder';
import { registerDialect, resetDialectConfig } from '../../src/dialects/registry';
import type { Dialect } from '../../src/dialects/capabilities';
import { createFakeDelegate, fakeRows } from '../helpers/fake-delegate';
import type { RecordedArgs } from '../helpers/fake-delegate';

type Clause = Record<string, unknown>;

/** The `OR` arms of the recorded `where` (search output). */
function orArms(recorded: RecordedArgs): Record<string, Clause>[] {
  return (recorded.findManyArgs?.where as { OR: Record<string, Clause>[] }).OR;
}

afterEach(() => {
  resetDialectConfig();
});

describe('QueryBuilder conditions', () => {
  it('search adds OR contains WITHOUT mode on the universal dialect', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .search({ searchText: 'jo', fields: ['email', 'id'] })
      .execute();
    const clause = orArms(recorded)[0]?.email;
    expect(clause).toEqual({ contains: 'jo' });
    expect(clause?.mode).toBeUndefined();
  });

  it('search adds mode insensitive for postgres', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'postgresql' })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    expect(orArms(recorded)[0]?.email).toEqual({ contains: 'jo', mode: 'insensitive' });
  });

  it('search never emits mode for mysql (would throw on MySQL)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'mysql' })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    expect(orArms(recorded)[0]?.email).toEqual({ contains: 'jo' });
  });

  it('registerDialect changes search output without core changes (coverage gap 7)', async () => {
    registerDialect('futuredb', { caseInsensitiveMode: true, caseInsensitiveCollation: false });
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate, { dialect: 'futuredb' as Dialect })
      .search({ searchText: 'jo', fields: ['email'] })
      .execute();
    expect(orArms(recorded)[0]?.email).toEqual({ contains: 'jo', mode: 'insensitive' });
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

  it('range adds nothing for a dangerous path (audit F16)', async () => {
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

describe('QueryBuilder search robustness (audits F13, G7)', () => {
  it('OR arms do not share one match object reference (audit F13)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate)
      .search({ searchText: 'jo', fields: ['email', 'id'] })
      .execute();
    const arms = orArms(recorded);
    expect(arms[0]?.email).not.toBe(arms[1]?.id);
  });

  it('whitespace-only searchText adds no condition (audit G7)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).search({ searchText: '   ', fields: ['email'] }).execute();
    expect(recorded.findManyArgs?.where).toBeUndefined();
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

describe('QueryBuilder custom undefined strip (audit F15)', () => {
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
    await new QueryBuilder(delegate).custom({ where: { a: undefined } }).execute();
    expect(recorded.findManyArgs?.where).toBeUndefined();
  });
});

describe('QueryBuilder sorting (audits F6, G1)', () => {
  it('sortBy expands dot paths into nested orderBy (audit F6)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'avatar.size', sortOrder: 'asc' }).execute();
    expect(recorded.findManyArgs?.orderBy).toEqual({ avatar: { size: 'asc' } });
  });

  it('sortBy keeps flat keys flat', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'createdAt' }).execute();
    expect(recorded.findManyArgs?.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('sortBy adds nothing for a dangerous path (audit F16)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).sortBy({ sortBy: 'a.__proto__.b' }).execute();
    expect(recorded.findManyArgs?.orderBy).toBeUndefined();
  });

  it('orderBy sends multi-key orderBy verbatim (audit G1)', async () => {
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

  it('executeWithMeta throws under cursor mode and never calls the delegate (audit F1)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate).cursorPaginate({ limit: 3 }).executeWithMeta(),
    ).rejects.toThrow('executeWithMeta() is offset-mode only');
    expect(recorded.findManyArgs).toBeUndefined();
    expect(recorded.countArgs).toBeUndefined();
  });

  it('includeTotal: false skips the COUNT query (audit G3)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(40));
    const { meta, data } = await new QueryBuilder(delegate).executeWithMeta({
      includeTotal: false,
    });
    expect(recorded.countArgs).toBeUndefined();
    expect(meta).toEqual({ page: 1, limit: 10, total: null, totalPage: null });
    expect(data).toHaveLength(10);
  });
});

describe('QueryBuilder strictNumbers (audits F12, F18)', () => {
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

  it('throws when the computed skip exceeds the cap (audit F18)', async () => {
    const { delegate } = createFakeDelegate(fakeRows(3));
    await expect(
      new QueryBuilder(delegate, { strictNumbers: true })
        .paginate({ page: 1e9, limit: 1000 })
        .execute(),
    ).rejects.toThrow('skip');
  });

  it('caps skip silently by default (audit F18)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(3));
    await new QueryBuilder(delegate).paginate({ page: 1e9, limit: 1000 }).execute();
    expect(recorded.findManyArgs?.skip).toBe(100_000);
  });

  it('throws the skip cap before the COUNT fires (audit F18)', async () => {
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

  it('backward page returns the rows adjacent to the cursor, in sort order', async () => {
    const { delegate } = createFakeDelegate(fakeRows(30));
    const { data, meta } = await new QueryBuilder(delegate)
      .sortBy({ sortBy: 'id', sortOrder: 'asc' })
      .cursorPaginate({ cursor: 'u25', direction: 'backward', limit: 3 })
      .executeWithCursor();
    expect(data.map((r) => r.id)).toEqual(['u22', 'u23', 'u24']);
    expect(meta.hasPrevPage).toBe(true);
    expect(meta.prevCursor).toBe('u22');
    expect(meta.nextCursor).toBe('u24');
  });

  it('next cursor round-trips to the following page without overlap (audit F4)', async () => {
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

  it('throws when the select drops the cursorField (audit F5)', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate)
        .select({ id: true })
        .cursorPaginate({ cursorField: 'email' })
        .executeWithCursor(),
    ).rejects.toThrow('projection drops cursorField');
  });

  it('passes when the select keeps the cursorField (audit F5)', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    const { data } = await new QueryBuilder(delegate)
      .select({ id: true, email: true })
      .cursorPaginate({ cursorField: 'email' })
      .executeWithCursor();
    expect(data).toHaveLength(5);
  });

  it('also guards a select supplied via custom() (audit F5)', async () => {
    const { delegate } = createFakeDelegate(fakeRows(5));
    await expect(
      new QueryBuilder(delegate)
        .custom({ select: { id: true } })
        .cursorPaginate({ cursorField: 'email' })
        .executeWithCursor(),
    ).rejects.toThrow('projection drops cursorField');
  });

  it('strict mode makes hasPrevPage exact when the cursor sits on the first row (audit F10)', async () => {
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

  it('strict probe mirrors the query where and orderBy (audit F10)', async () => {
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

  it('strict mode makes hasNextPage exact on an empty backward page (audit G9)', async () => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    const { data, meta } = await new QueryBuilder(delegate)
      .cursorPaginate({ cursor: 'u0', limit: 5, direction: 'backward', strict: true })
      .executeWithCursor();
    expect(data).toHaveLength(0); // nothing before u0
    expect(meta.hasNextPage).toBe(true); // u0 itself exists — exact, not optimistic false
    expect(recorded.findManyCalls[1]?.take).toBe(1);
  });

  it('no probe query without strict (audit F10)', async () => {
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

  it('paginate().first() returns the global first row (audit G5 semantics)', async () => {
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

describe('cursorPaginate empty cursors', () => {
  it.each([null, ''])('treats %j as the first page', async (cursor) => {
    const { delegate, recorded } = createFakeDelegate(fakeRows(30));
    await new QueryBuilder(delegate).cursorPaginate({ cursor, limit: 5 }).executeWithCursor();
    expect(recorded.findManyArgs?.cursor).toBeUndefined();
    expect(recorded.findManyArgs?.skip).toBeUndefined();
  });
});
