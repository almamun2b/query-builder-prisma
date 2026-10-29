import type { Prisma } from 'generated/prisma/client';

/**
 * Minimal structural contract every Prisma model delegate (e.g. `prisma.user`)
 * already satisfies. It is only used as an upper bound so the concrete delegate
 * type is preserved at call sites while keeping the class generic.
 */
interface PrismaModelDelegate {
  findMany: (...args: never[]) => unknown;
  count: (...args: never[]) => unknown;
}

/** `findMany` arguments for the given delegate, derived straight from Prisma. */
type FindManyArgsOf<TDelegate extends PrismaModelDelegate> = NonNullable<
  Parameters<TDelegate['findMany']>[0]
>;

type WhereOf<TDelegate extends PrismaModelDelegate> = NonNullable<
  FindManyArgsOf<TDelegate>['where']
>;

type SelectOf<TDelegate extends PrismaModelDelegate> = NonNullable<
  FindManyArgsOf<TDelegate>['select']
>;

type IncludeOf<TDelegate extends PrismaModelDelegate> = NonNullable<
  FindManyArgsOf<TDelegate>['include']
>;

type OrderByOf<TDelegate extends PrismaModelDelegate> = NonNullable<
  FindManyArgsOf<TDelegate>['orderBy']
>;

/** Scalar/relation keys that can be referenced from a model's `where` input. */
type WhereKeyOf<TDelegate extends PrismaModelDelegate> = keyof WhereOf<TDelegate> & string;

/**
 * A partial `where` whose values may also be `undefined`, so optional query
 * params can be forwarded directly (they are stripped out at build time).
 */
type FilterInput<TDelegate extends PrismaModelDelegate> = {
  [K in WhereKeyOf<TDelegate>]?: WhereOf<TDelegate>[K] | undefined;
};

/** Keys that can be used to order a model's results. */
type OrderKeyOf<TDelegate extends PrismaModelDelegate> =
  OrderByOf<TDelegate> extends infer O
    ? O extends readonly unknown[]
      ? keyof O[number] & string
      : keyof O & string
    : never;

type SortOrder = 'asc' | 'desc';

/** A single numeric/date/string bound used by {@link QueryBuilder.range}. */
type RangeBound = string | number | Date;

interface RangeInput {
  from?: RangeBound | undefined;
  to?: RangeBound | undefined;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPage: number;
}

/** Direction to walk through a cursor-paginated result set. */
type CursorDirection = 'forward' | 'backward';

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
 * Generic, reusable and fully type-safe query builder for any Prisma model
 * delegate. All option types (`where`, `select`, `include`, `orderBy`, ...) are
 * inferred from the delegate passed to the constructor, so no model-specific
 * types need to be declared by the caller.
 *
 * The result type of {@link execute}/{@link executeWithMeta} is narrowed by the
 * `.select()` / `.include()` calls, exactly mirroring Prisma's own behaviour.
 *
 * @typeParam TDelegate - The Prisma model delegate, e.g. `typeof prisma.user`.
 * @typeParam TArgs - Accumulated `findMany` args. Defaults to no projection.
 *
 * @example
 * const result = await new QueryBuilder(prisma.user)
 *   .search({ searchText, fields: ['email', 'username'] })
 *   .filter({ role, status })
 *   .range({ createdAt: { from, to }, 'avatar.size': { from: min, to: max } })
 *   .sortBy({ sortBy: 'createdAt', sortOrder: 'desc' })
 *   .paginate({ page: 1, limit: 10 })
 *   .select({ id: true, email: true })
 *   .execute();
 */
export class QueryBuilder<TDelegate extends PrismaModelDelegate, TArgs = object> {
  private readonly delegate: TDelegate;
  private readonly andConditions: object[] = [];
  private customArgs: Record<string, unknown> = {};
  private orderBy: object | undefined;
  private selectArg: object | undefined;
  private includeArg: object | undefined;
  private page: number | undefined;
  private limit: number | undefined;
  private cursorActive = false;
  private cursor: string | undefined;
  private cursorLimit: number | undefined;
  private cursorField = 'id';
  private cursorDirection: CursorDirection = 'forward';

  /**
   * @param delegate - The Prisma delegate to query (e.g. `prisma.user`).
   * @param initialArgs - Optional raw `findMany` args to start from.
   */
  constructor(delegate: TDelegate, initialArgs?: FindManyArgsOf<TDelegate>) {
    this.delegate = delegate;
    if (initialArgs) {
      this.customArgs = { ...(initialArgs as object) };
    }
  }

  /**
   * Case-insensitive `contains` search across the provided string fields.
   * No condition is added when `searchText` is empty.
   */
  search(params: { searchText?: string | undefined; fields: WhereKeyOf<TDelegate>[] }): this {
    const { searchText, fields } = params;
    if (searchText && fields.length > 0) {
      this.andConditions.push({
        OR: fields.map((field) => ({
          [field]: { contains: searchText, mode: 'insensitive' },
        })),
      });
    }
    return this;
  }

  /**
   * Adds an equality/operator filter. Accepts a partial Prisma `where` object;
   * `undefined` values are ignored so optional query params are safe to pass.
   */
  filter(filters: FilterInput<TDelegate>): this {
    const cleaned = QueryBuilder.removeUndefined(filters);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /**
   * Adds `gte`/`lte` range conditions. Keys may be dot-paths to reach relations
   * or nested objects (e.g. `'avatar.size'`). Bounds left `undefined` are
   * skipped, and a field is only added when at least one bound is present.
   */
  range(ranges: Record<string, RangeInput>): this {
    for (const [path, bound] of Object.entries(ranges)) {
      const condition: Record<string, RangeBound> = {};
      if (bound.from !== undefined) {
        condition.gte = bound.from;
      }
      if (bound.to !== undefined) {
        condition.lte = bound.to;
      }
      if (Object.keys(condition).length > 0) {
        this.andConditions.push(QueryBuilder.buildNestedPath(path, condition));
      }
    }
    return this;
  }

  /** Adds an arbitrary, fully-typed Prisma `where` condition. */
  where(condition: WhereOf<TDelegate>): this {
    const cleaned = QueryBuilder.removeUndefined(condition);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /** Sets `orderBy`. No-op when `sortBy` is not provided. */
  sortBy(params: { sortBy?: OrderKeyOf<TDelegate> | (string & {}); sortOrder?: SortOrder }): this {
    const { sortBy, sortOrder = 'desc' } = params;
    if (sortBy) {
      this.orderBy = { [sortBy]: sortOrder };
    }
    return this;
  }

  /** Configures `skip`/`take` from a 1-based page number and page size. */
  paginate(params: { page?: number; limit?: number }): this {
    this.page = params.page ?? 1;
    this.limit = params.limit ?? 10;
    return this;
  }

  /**
   * Configures cursor-based ("seek") pagination. Use {@link executeWithCursor}
   * to run the query and obtain `next`/`prev` cursors.
   *
   * - `cursor` is the value of `cursorField` from the edge row of the previous
   *   page (omit it for the first page).
   * - `direction` walks `'forward'` (next) or `'backward'` (previous).
   * - `cursorField` is the unique, sequential column to seek on (default `id`).
   *   Pair it with a matching {@link sortBy} for stable ordering.
   *
   * Takes precedence over {@link paginate} when both are set.
   */
  cursorPaginate(params: {
    cursor?: string | undefined;
    limit?: number;
    direction?: CursorDirection;
    cursorField?: OrderKeyOf<TDelegate> | (string & {});
  }): this {
    this.cursorActive = true;
    this.cursor = params.cursor;
    this.cursorLimit = params.limit ?? 10;
    this.cursorDirection = params.direction ?? 'forward';
    this.cursorField = params.cursorField ?? 'id';
    return this;
  }

  /**
   * Projects fields with Prisma `select`. The result type of `execute` is
   * narrowed to exactly the selected shape.
   */
  select<TSelect extends SelectOf<TDelegate>>(
    select: TSelect
  ): QueryBuilder<TDelegate, Omit<TArgs, 'select' | 'include'> & { select: TSelect }> {
    this.selectArg = select;
    this.includeArg = undefined;
    return this as unknown as QueryBuilder<
      TDelegate,
      Omit<TArgs, 'select' | 'include'> & { select: TSelect }
    >;
  }

  /**
   * Eager-loads relations with Prisma `include`. The result type of `execute`
   * is widened with the included relations.
   */
  include<TInclude extends IncludeOf<TDelegate>>(
    include: TInclude
  ): QueryBuilder<TDelegate, Omit<TArgs, 'select' | 'include'> & { include: TInclude }> {
    this.includeArg = include;
    this.selectArg = undefined;
    return this as unknown as QueryBuilder<
      TDelegate,
      Omit<TArgs, 'select' | 'include'> & { include: TInclude }
    >;
  }

  /** Merges raw `findMany` args, e.g. `cursor`, `distinct` or a custom `where`. */
  custom(args: FindManyArgsOf<TDelegate>): this {
    this.customArgs = { ...this.customArgs, ...(args as object) };
    return this;
  }

  /** The fully assembled `findMany` args. Useful for debugging or reuse. */
  buildArgs(): FindManyArgsOf<TDelegate> {
    const args: Record<string, unknown> = { ...this.customArgs };

    const where = this.buildWhere();
    if (where) {
      args.where = where;
    }
    if (this.orderBy) {
      args.orderBy = this.orderBy;
    }
    if (this.selectArg) {
      args.select = this.selectArg;
    }
    if (this.includeArg) {
      args.include = this.includeArg;
    }
    if (this.cursorActive) {
      const limit = this.cursorLimit ?? 10;
      args.take = (this.cursorDirection === 'backward' ? -1 : 1) * (limit + 1);
      if (this.cursor !== undefined) {
        args.cursor = { [this.cursorField]: this.cursor };
        args.skip = 1;
      }
    } else if (this.limit !== undefined) {
      const page = this.page ?? 1;
      args.take = this.limit;
      args.skip = (page - 1) * this.limit;
    }

    return args as FindManyArgsOf<TDelegate>;
  }

  /** Executes the query and returns the rows, typed from `.select()`/`.include()`. */
  async execute(): Promise<Prisma.Result<TDelegate, TArgs, 'findMany'>> {
    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object
    ) => Promise<unknown>;
    const data = await findMany(this.buildArgs());
    return data as Prisma.Result<TDelegate, TArgs, 'findMany'>;
  }

  /** Counts rows matching the current filters (ignores pagination/projection). */
  async count(): Promise<number> {
    const where = this.buildWhere();
    const count = this.delegate.count.bind(this.delegate) as unknown as (
      args: object
    ) => Promise<number>;
    return count(where ? { where } : {});
  }

  /** Executes the query and returns the rows plus pagination metadata. */
  async executeWithMeta(): Promise<{
    meta: PaginationMeta;
    data: Prisma.Result<TDelegate, TArgs, 'findMany'>;
  }> {
    const page = this.page ?? 1;
    const limit = this.limit ?? 10;

    const [total, data] = await Promise.all([this.count(), this.execute()]);

    return {
      meta: { page, limit, total, totalPage: Math.ceil(total / limit) },
      data,
    };
  }

  /**
   * Executes a cursor-paginated query (see {@link cursorPaginate}) and returns
   * the page rows plus `next`/`prev` cursors. Rows are always returned in the
   * configured sort order, regardless of pagination `direction`.
   */
  async executeWithCursor(): Promise<{
    meta: CursorMeta;
    data: Prisma.Result<TDelegate, TArgs, 'findMany'>;
  }> {
    if (!this.cursorActive) {
      this.cursorPaginate({});
    }
    const limit = this.cursorLimit ?? 10;
    const direction = this.cursorDirection;

    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object
    ) => Promise<Record<string, unknown>[]>;
    const rows = await findMany(this.buildArgs());

    const hasExtra = rows.length > limit;
    const pageRows = hasExtra ? rows.slice(0, limit) : rows;
    const ordered = direction === 'backward' ? [...pageRows].reverse() : pageRows;

    const firstRow = ordered[0];
    const lastRow = ordered[ordered.length - 1];
    const hadCursor = this.cursor !== undefined;

    const hasRows = rows.length > 0;
    const hasNextPage = direction === 'forward' ? hasExtra : hadCursor && hasRows;
    const hasPrevPage = direction === 'backward' ? hasExtra : hadCursor && hasRows;

    const meta: CursorMeta = {
      limit,
      nextCursor: hasNextPage && lastRow ? String(lastRow[this.cursorField]) : null,
      prevCursor: hasPrevPage && firstRow ? String(firstRow[this.cursorField]) : null,
      hasNextPage,
      hasPrevPage,
    };

    return {
      meta,
      data: ordered as unknown as Prisma.Result<TDelegate, TArgs, 'findMany'>,
    };
  }

  private buildWhere(): object | undefined {
    const conditions = [...this.andConditions];

    const customWhere = this.customArgs.where;
    if (customWhere && typeof customWhere === 'object') {
      conditions.unshift(customWhere);
    }

    if (conditions.length === 0) {
      return undefined;
    }
    return { AND: conditions };
  }

  private static removeUndefined(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }

  private static buildNestedPath(path: string, value: object): object {
    const keys = path.split('.');
    let current: object = value;
    for (let i = keys.length - 1; i >= 0; i--) {
      current = { [keys[i]!]: current };
    }
    return current;
  }
}
