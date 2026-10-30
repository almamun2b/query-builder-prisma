import type { PrismaModelDelegate } from '../../src/types/delegate';

/**
 * A hand-written fake delegate. Deliberately contains NO Prisma code - if this
 * satisfies the builder, any real Prisma delegate (any version) will too.
 */
export interface FakeRow {
  id: string;
  email: string;
  status: string;
}

export interface FakeFindArgs {
  where?: Record<string, unknown> | undefined;
  select?: Record<string, boolean | object> | undefined;
  include?: Record<string, boolean | object> | undefined;
  orderBy?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[] | undefined;
  skip?: number | undefined;
  take?: number | undefined;
  cursor?: Record<string, unknown> | undefined;
  distinct?: string[] | undefined;
}

export interface RecordedArgs {
  findManyArgs?: FakeFindArgs | undefined;
  /** Every `findMany` call in order — strict cursor mode issues a probe call (audit F10). */
  findManyCalls: (FakeFindArgs | undefined)[];
  countArgs?: Record<string, unknown> | undefined;
}

/** Build n deterministic fake rows. */
export function fakeRows(n: number): FakeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${String(i)}`,
    email: `e${String(i)}@x.dev`,
    status: 'ACTIVE',
  }));
}

/**
 * Cursor-cell match with Prisma's DateTime coercion: ISO strings are accepted
 * for Date cells (this is what makes serialized cursors round-trippable — the
 * exact property audit F4 guarantees).
 */
function matchesCursorCell(row: FakeRow, field: string, value: unknown): boolean {
  const cell: unknown = (row as unknown as Record<string, unknown>)[field];
  if (cell instanceof Date) {
    return cell.toISOString() === String(value);
  }
  return cell === value;
}

export function createFakeDelegate(rows: FakeRow[] = []): {
  delegate: {
    findMany: (args?: FakeFindArgs) => Promise<FakeRow[]>;
    count: (args?: Record<string, unknown>) => Promise<number>;
  };
  recorded: RecordedArgs;
} {
  const recorded: RecordedArgs = { findManyCalls: [] };
  const query = (args?: FakeFindArgs): FakeRow[] => {
    recorded.findManyArgs = args;
    recorded.findManyCalls.push(args);

    const skip = typeof args?.skip === 'number' ? args.skip : 0;
    const take = typeof args?.take === 'number' ? args.take : undefined;

    // Emulate Prisma cursor semantics: the cursor anchors AT the matching
    // row, `skip: 1` excludes the cursor row, positive take walks forward,
    // negative take walks backward. Like real Prisma (verified against a
    // SQLite client), rows always come back in the query's sort order.
    const cursorArg = args?.cursor;
    const firstCursor = cursorArg ? Object.entries(cursorArg)[0] : undefined;
    if (firstCursor !== undefined) {
      const [field, value] = firstCursor;
      const anchor = rows.findIndex((row) => matchesCursorCell(row, field, value));
      if (anchor === -1) {
        return [];
      }
      if (take !== undefined && take < 0) {
        return rows.slice(0, anchor).slice(-Math.abs(take));
      }
      const after = rows.slice(anchor + Math.max(skip, 1));
      return take !== undefined ? after.slice(0, take) : after;
    }

    // Emulate Prisma: apply skip, then take; negative take returns the last
    // rows, still in sort order.
    let out = rows;
    if (skip > 0) out = out.slice(skip);
    if (take !== undefined) {
      out = take < 0 ? out.slice(-Math.abs(take)) : out.slice(0, take);
    }
    return out;
  };
  const delegate = {
    findMany: (args?: FakeFindArgs): Promise<FakeRow[]> => Promise.resolve(query(args)),
    count: (args?: Record<string, unknown>): Promise<number> => {
      recorded.countArgs = args;
      return Promise.resolve(rows.length);
    },
  };
  // Prove the fake satisfies the structural contract WITHOUT erasing its
  // rich argument types (the builder derives all types from the concrete type).
  return { delegate: delegate satisfies PrismaModelDelegate, recorded };
}
