import type {
  FindManyArgsOf,
  IncludeOf,
  OrderKeyOf,
  PrismaModelDelegate,
  RowElementOf,
  SelectOf,
  WhereKeyOf,
  WhereOf,
} from '../types/delegate';
import type { ApplyProjection, FindResultOf } from '../types/projection';
import type {
  CursorDirection,
  CursorMeta,
  FilterInput,
  PaginationMeta,
  RangeBound,
  RangeInput,
  SortOrder,
} from '../types/public';
import { combineAnd, expandDotPath, stripUndefined } from './conditions';
import {
  buildCursorPage,
  buildPaginationMeta,
  toCursorArgs,
  toOffsetArgs,
  DEFAULT_PAGE_SIZE,
} from './pagination';
import { resolveDialect } from '../dialects/registry';
import type { Dialect } from '../dialects/capabilities';

/** Options accepted by the {@link QueryBuilder} constructor. */
export interface QueryBuilderOptions<D extends PrismaModelDelegate> {
  /** Seed `findMany` args, e.g. `{ where: { deletedAt: null } }` (prepended to every `where`). */
  initialArgs?: FindManyArgsOf<D> | undefined;
  /**
   * Per-builder dialect override. When omitted: global `configureQueryBuilder()`
   * config → registered auto-detector → `'universal'` (always-valid args).
   */
  dialect?: Dialect | undefined;
}

/** Thrown by {@link QueryBuilder.firstOrThrow} when no row matched. */
export class NoResultError extends Error {
  constructor() {
    super('Query returned no rows');
    this.name = 'NoResultError';
  }
}

/**
 * Generic, reusable and fully type-safe query builder for any Prisma model
 * delegate, on every Prisma version (see PLAN.md).
 *
 * All option types (`where`, `select`, `include`, `orderBy`, ...) are inferred
 * structurally from the delegate passed to the constructor — nothing is imported
 * from Prisma, so no Prisma upgrade can ever break this class.
 *
 * The result type of `execute()` is narrowed by `.select()` / `.include()` via a
 * structural projection engine, mirroring Prisma's own behaviour.
 *
 * @typeParam D - The Prisma model delegate, e.g. `typeof prisma.user`.
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
export class QueryBuilder<D extends PrismaModelDelegate, TArgs = object> {
  private readonly delegate: D;
  private readonly dialect: Dialect | undefined;
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
  private cursorDirection: CursorDirection = 'forward';
  private cursorField: string = 'id';

  /**
   * @param delegate - The Prisma delegate to query (e.g. `prisma.user`).
   * @param options - Optional seed args and/or a dialect override.
   */
  constructor(delegate: D, options?: QueryBuilderOptions<D>) {
    this.delegate = delegate;
    this.dialect = options?.dialect;
    if (options?.initialArgs) {
      this.customArgs = { ...(options.initialArgs as object) };
    }
  }

  /**
   * Case-insensitive `contains` across the provided string fields. No condition
   * is added when `searchText` is empty.
   *
   * Dialect-aware: adds `mode: 'insensitive'` only where Prisma accepts it
   * (postgresql, cockroachdb, mongodb). On mysql/mariadb/sqlserver the bare
   * `contains` relies on the database's collation; on sqlite matching is
   * case-sensitive for ASCII (Prisma offers no alternative there).
   */
  search(params: { searchText?: string | undefined; fields: WhereKeyOf<D>[] }): this {
    const { searchText, fields } = params;
    if (searchText && fields.length > 0) {
      const { capabilities } = resolveDialect(this.dialect);
      const match: Record<string, unknown> = { contains: searchText };
      if (capabilities.caseInsensitiveMode) {
        match.mode = 'insensitive';
      }
      this.andConditions.push({ OR: fields.map((field) => ({ [field]: match })) });
    }
    return this;
  }

  /**
   * Adds an equality/operator filter. Accepts a partial Prisma `where` object;
   * `undefined` values are ignored so optional query params are safe to pass.
   */
  filter(filters: FilterInput<D>): this {
    const cleaned = stripUndefined(filters);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /**
   * Adds `gte`/`lte` range conditions. Keys may be dot-paths to reach relations
   * or nested objects (e.g. `'avatar.size'`). Bounds left `undefined` are
   * skipped; a field is only added when at least one bound is present.
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
        this.andConditions.push(expandDotPath(path, condition));
      }
    }
    return this;
  }

  /** Adds an arbitrary, fully-typed Prisma `where` condition. */
  where(condition: WhereOf<D>): this {
    const cleaned = stripUndefined(condition as Record<string, unknown>);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /** Sets `orderBy`. No-op when `sortBy` is not provided. */
  sortBy(params: { sortBy?: OrderKeyOf<D> | (string & {}); sortOrder?: SortOrder }): this {
    const { sortBy, sortOrder = 'desc' } = params;
    if (sortBy) {
      this.orderBy = { [sortBy]: sortOrder };
    }
    return this;
  }

  /** Configures `skip`/`take` from a 1-based page number and page size. */
  paginate(params: { page?: number; limit?: number }): this {
    this.page = params.page ?? 1;
    this.limit = params.limit ?? DEFAULT_PAGE_SIZE;
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
    cursorField?: OrderKeyOf<D> | (string & {});
  }): this {
    this.cursorActive = true;
    this.cursor = params.cursor;
    this.cursorLimit = params.limit;
    this.cursorDirection = params.direction ?? 'forward';
    this.cursorField = params.cursorField ?? 'id';
    return this;
  }

  /**
   * Projects fields with Prisma `select`. The result type of `execute()` is
   * narrowed to exactly the selected shape. Clears any active `.include()`.
   */
  select<TSelect extends SelectOf<D>>(
    select: TSelect,
  ): QueryBuilder<D, Omit<TArgs, 'select' | 'include'> & { select: TSelect }> {
    this.selectArg = select;
    this.includeArg = undefined;
    return this as unknown as QueryBuilder<
      D,
      Omit<TArgs, 'select' | 'include'> & { select: TSelect }
    >;
  }

  /**
   * Eager-loads relations with Prisma `include`. The result type of `execute()`
   * is widened with the included relations. Clears any active `.select()`.
   */
  include<TInclude extends IncludeOf<D>>(
    include: TInclude,
  ): QueryBuilder<D, Omit<TArgs, 'select' | 'include'> & { include: TInclude }> {
    this.includeArg = include;
    this.selectArg = undefined;
    return this as unknown as QueryBuilder<
      D,
      Omit<TArgs, 'select' | 'include'> & { include: TInclude }
    >;
  }

  /** Merges raw `findMany` args, e.g. `cursor`, `distinct` or a custom `where`. */
  custom(args: FindManyArgsOf<D>): this {
    this.customArgs = { ...this.customArgs, ...(args as object) };
    return this;
  }

  /** The fully assembled `findMany` args. Useful for debugging or reuse. */
  buildArgs(): FindManyArgsOf<D> {
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
      const cursorArgs = toCursorArgs({
        cursor: this.cursor,
        limit: this.cursorLimit,
        direction: this.cursorDirection,
        cursorField: this.cursorField,
      });
      args.take = cursorArgs.take;
      if (cursorArgs.cursor) {
        args.cursor = cursorArgs.cursor;
      }
      if (cursorArgs.skip !== undefined) {
        args.skip = cursorArgs.skip;
      }
    } else if (this.limit !== undefined) {
      const offset = toOffsetArgs(this.page ?? 1, this.limit);
      args.take = offset.take;
      args.skip = offset.skip;
    }

    return args as FindManyArgsOf<D>;
  }

  /**
   * Executes the query and returns the rows, typed from `.select()`/`.include()`.
   *
   * Tip: for 100% Prisma-native inference you can always run the passthrough
   * `prisma.user.findMany(qb.buildArgs())` — same args, Prisma's own overloads.
   */
  async execute(): Promise<FindResultOf<D, TArgs>> {
    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object,
    ) => Promise<unknown>;
    const data = await findMany(this.buildArgs());
    return data as FindResultOf<D, TArgs>;
  }

  /** Executes the query and returns the first row, or `null` when none matched. */
  async first(): Promise<ApplyProjection<RowElementOf<D>, TArgs> | null> {
    const args = { ...(this.buildArgs() as object) } as Record<string, unknown>;
    args.take = 1;
    delete args.skip;
    delete args.cursor;
    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object,
    ) => Promise<unknown>;
    const rows = (await findMany(args)) as unknown[];
    const row = rows[0];
    return (row ?? null) as ApplyProjection<RowElementOf<D>, TArgs> | null;
  }

  /** Like {@link first}, but throws {@link NoResultError} when nothing matched. */
  async firstOrThrow(): Promise<ApplyProjection<RowElementOf<D>, TArgs>> {
    const row = await this.first();
    if (row === null) {
      throw new NoResultError();
    }
    return row;
  }

  /** Counts rows matching the current filters (ignores pagination/projection). */
  async count(): Promise<number> {
    const where = this.buildWhere();
    const countFn = this.delegate.count.bind(this.delegate) as unknown as (
      args: object,
    ) => Promise<number>;
    return countFn(where ? { where } : {});
  }

  /**
   * Executes the query and returns the rows plus offset pagination metadata.
   * When no pagination was configured, defaults to page 1, limit 10 so `meta`
   * always describes the data actually returned. `count` and `findMany` run in
   * parallel.
   */
  async executeWithMeta(): Promise<{ meta: PaginationMeta; data: FindResultOf<D, TArgs> }> {
    if (!this.cursorActive && this.limit === undefined) {
      this.paginate({ page: 1, limit: DEFAULT_PAGE_SIZE });
    }
    const offset = toOffsetArgs(this.page ?? 1, this.limit ?? DEFAULT_PAGE_SIZE);

    const [total, data] = await Promise.all([this.count(), this.execute()]);

    return {
      meta: buildPaginationMeta(total, offset.page, offset.limit),
      data,
    };
  }

  /**
   * Executes a cursor-paginated query (see {@link cursorPaginate}) and returns
   * the page rows plus `next`/`prev` cursors. Rows are always returned in the
   * configured sort order, regardless of pagination `direction`.
   */
  async executeWithCursor(): Promise<{ meta: CursorMeta; data: FindResultOf<D, TArgs> }> {
    if (!this.cursorActive) {
      this.cursorPaginate({});
    }
    const limit = this.cursorLimit ?? DEFAULT_PAGE_SIZE;
    const hadCursor = this.cursor !== undefined;

    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object,
    ) => Promise<Record<string, unknown>[]>;
    const rows = await findMany(this.buildArgs());

    const { data, meta } = buildCursorPage(rows, {
      limit,
      direction: this.cursorDirection,
      cursorField: this.cursorField,
      hadCursor,
    });

    return { meta, data: data as unknown as FindResultOf<D, TArgs> };
  }

  private buildWhere(): object | undefined {
    return combineAnd(this.andConditions, this.customArgs.where);
  }
}
