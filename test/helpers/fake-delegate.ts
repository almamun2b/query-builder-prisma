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
  where?: Record<string, unknown>;
  select?: Record<string, boolean | object>;
  include?: Record<string, boolean | object>;
  orderBy?: Record<string, 'asc' | 'desc'>;
  skip?: number;
  take?: number;
  cursor?: Record<string, unknown>;
  distinct?: string[];
}

export interface RecordedArgs {
  findManyArgs?: FakeFindArgs;
  countArgs?: Record<string, unknown>;
}

/** Build n deterministic fake rows. */
export function fakeRows(n: number): FakeRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `u${i}`,
    email: `e${i}@x.dev`,
    status: 'ACTIVE',
  }));
}

export function createFakeDelegate(rows: FakeRow[] = []): {
  delegate: {
    findMany: (args?: FakeFindArgs) => Promise<FakeRow[]>;
    count: (args?: Record<string, unknown>) => Promise<number>;
  };
  recorded: RecordedArgs;
} {
  const recorded: RecordedArgs = {};
  const delegate = {
    findMany: async (args?: FakeFindArgs): Promise<FakeRow[]> => {
      recorded.findManyArgs = args;
      // Emulate Prisma: apply skip, then take (absolute value for backward seek).
      const skip = typeof args?.skip === 'number' ? args.skip : 0;
      const take = typeof args?.take === 'number' ? Math.abs(args.take) : undefined;
      let out = rows;
      if (skip > 0) out = out.slice(skip);
      if (take !== undefined) out = out.slice(0, take);
      return out;
    },
    count: async (args?: Record<string, unknown>): Promise<number> => {
      recorded.countArgs = args;
      return rows.length;
    },
  };
  // Prove the fake satisfies the structural contract WITHOUT erasing its
  // rich argument types (the builder derives all types from the concrete type).
  const contract: PrismaModelDelegate = delegate;
  void contract;
  return { delegate, recorded };
}
