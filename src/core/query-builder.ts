import type {
  FindManyArgsOf,
  IncludeOf,
  OrderByOf,
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
  PaginationMetaNoTotal,
  RangeBound,
  RangeInput,
  SortOrder,
} from '../types/public';
import {
  combineAnd,
  deepStripUndefined,
  expandDotPath,
  isPlainObject,
  stripUndefined,
} from './conditions';
import {
  buildCursorPage,
  buildPaginationMeta,
  clampLimit,
  clampPage,
  toCursorArgs,
  toOffsetArgs,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_SKIP,
} from './pagination';
import type { ExactCursorFlags } from './pagination';
import { resolveDialect } from '../dialects/registry';
import type { Dialect } from '../dialects/capabilities';

/** Options accepted by the {@link QueryBuilder} constructor. */
export interface QueryBuilderOptions<D extends PrismaModelDelegate> {
  /** Seed `findMany` args, e.g. `{ where: { deletedAt: null } }` (prepended to every `where`). */
  initialArgs?: FindManyArgsOf<D> | undefined;
  /**
   * Per-builder dialect override. When omitted: global `configQueryBuilder()`
   * config → registered auto-detector → `'universal'` (always-valid args).
   */
  dialect?: Dialect | undefined;
  /**
   * Throw on out-of-range pagination input instead of clamping silently:
   * limits outside `[1, 1000]`, pages below 1, or a computed `skip` beyond
   * `MAX_SKIP` (audits F12 / F18). Defaults to clamping.
   */
  strictNumbers?: boolean | undefined;
}

/** Meta type of {@link QueryBuilder.executeWithMeta} for the given options. */
type MetaOf<O extends { includeTotal?: boolean }> = O['includeTotal'] extends false
  ? PaginationMetaNoTotal
  : PaginationMeta;

/** Thrown by {@link QueryBuilder.firstOrThrow} when no row matched. */
export class NoResultError extends Error {
  constructor() {
    super('Query returned no rows');
    this.name = 'NoResultError';
  }
}

/**
 * Generic, reusable and fully type-safe query builder for any Prisma model
 * delegate, on every Prisma version (see ARCHITECTURE.md).
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
  private readonly strictNumbers: boolean;
  private readonly andConditions: object[] = [];
  private customArgs: Record<string, unknown> = {};
  /**
   * The `initialArgs` seed `where` plus every `.custom({ where })`, AND-merged.
   * Kept out of `customArgs` so a later `.custom({ where })` merges with the
   * seed instead of replacing it (audit F2 — the seed carries safety filters).
   */
  private customWhere: unknown;
  private orderByArg: object | undefined;
  private selectArg: object | undefined;
  private includeArg: object | undefined;
  private page: number | undefined;
  private limit: number | undefined;
  private cursorActive = false;
  private cursor: string | number | Date | undefined;
  private cursorLimit: number | undefined;
  private cursorDirection: CursorDirection = 'forward';
  private cursorField = 'id';
  private cursorStrict = false;

  /**
   * @param delegate - The Prisma delegate to query (e.g. `prisma.user`).
   * @param options - Optional seed args, a dialect override, or `strictNumbers`.
   */
  constructor(delegate: D, options?: QueryBuilderOptions<D>) {
    this.delegate = delegate;
    this.dialect = options?.dialect;
    this.strictNumbers = options?.strictNumbers ?? false;
    // The lint checker resolves `FindManyArgsOf<D>` of a bare generic `D` to `never`.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    if (options?.initialArgs !== undefined) {
      const { where, ...rest } = options.initialArgs as Record<string, unknown>;
      this.customArgs = { ...rest };
      this.customWhere = where;
    }
  }

  /**
   * Case-insensitive `contains` across the provided string fields. No condition
   * is added when `searchText` is empty or whitespace-only (audit G7).
   *
   * Dialect-aware: adds `mode: 'insensitive'` only where Prisma accepts it (see
   * `caseInsensitiveMode` in `src/dialects/capabilities.ts`); everywhere else
   * the bare `contains` relies on the database's collation, and where that is
   * ASCII-only matching stays case-sensitive — Prisma offers no alternative
   * there.
   */
  search(params: { searchText?: string | undefined; fields: WhereKeyOf<D>[] }): this {
    const text = params.searchText?.trim();
    const fields = params.fields;
    if (text && fields.length > 0) {
      const { capabilities } = resolveDialect(this.dialect);
      this.andConditions.push({
        OR: fields.map((field) => {
          // One match object per arm — never a shared reference (audit F13).
          const match: Record<string, unknown> = { contains: text };
          if (capabilities.caseInsensitiveMode) {
            match.mode = 'insensitive';
          }
          return { [field]: match };
        }),
      });
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
        const expanded = expandDotPath(path, condition);
        if (Object.keys(expanded).length > 0) {
          this.andConditions.push(expanded);
        }
      }
    }
    return this;
  }

  /** Adds an arbitrary, fully-typed Prisma `where` condition. */
  where(condition: WhereOf<D>): this {
    const cleaned = stripUndefined(condition);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /**
   * Sets `orderBy` from a single key. No-op when `sortBy` is not provided.
   * Dot paths expand like `.range()` (`'avatar.size'` → `{ avatar: { size } }`,
   * audit F6). For multi-key or nested relation sorts use {@link orderBy}.
   */
  sortBy(params: { sortBy?: OrderKeyOf<D> | (string & {}); sortOrder?: SortOrder }): this {
    const { sortBy, sortOrder = 'desc' } = params;
    if (sortBy) {
      const expanded = expandDotPath(sortBy, sortOrder);
      if (Object.keys(expanded).length > 0) {
        this.orderByArg = expanded;
      }
    }
    return this;
  }

  /**
   * Sets `orderBy` verbatim from the full Prisma shape: arrays for multi-key
   * sorts, nested relation order objects. `.sortBy()` remains the single-key
   * convenience — the latest of the two calls wins (audit G1).
   */
  orderBy(order: OrderByOf<D>): this {
    this.orderByArg = order;
    return this;
  }

  /** Configures `skip`/`take` from a 1-based page number and page size. */
  paginate(params: { page?: number; limit?: number }): this {
    this.assertPage(params.page);
    this.assertLimit(params.limit);
    this.page = params.page ?? 1;
    this.limit = params.limit ?? DEFAULT_PAGE_SIZE;
    return this;
  }

  /**
   * Configures cursor-based ("seek") pagination. Use {@link executeWithCursor}
   * to run the query and obtain `next`/`prev` cursors.
   *
   * - `cursor` is the value of `cursorField` from the edge row of the previous
   *   page (omit it — or pass `null`/`''` — for the first page). Strings,
   *   numbers and Dates are accepted; Dates serialize to ISO-8601 in the
   *   returned cursors (audit F4). Returned cursors are always strings: for a
   *   numeric field convert back (`Number(cursor)`) before passing it in.
   * - `direction` walks `'forward'` (next) or `'backward'` (previous).
   * - `cursorField` is the unique, sequential column to seek on (default `id`).
   *   Pair it with a matching {@link sortBy} for stable ordering.
   * - `strict` spends one extra 1-row probe query to make `hasNextPage` /
   *   `hasPrevPage` exact instead of optimistic (audit F10).
   *
   * Takes precedence over {@link paginate} when both are set.
   */
  cursorPaginate(params: {
    cursor?: string | number | Date | null | undefined;
    limit?: number;
    direction?: CursorDirection;
    cursorField?: OrderKeyOf<D> | (string & {});
    strict?: boolean;
  }): this {
    this.assertLimit(params.limit);
    this.cursorActive = true;
    // `null` / '' (an empty query-string value) mean "first page", not a cursor.
    this.cursor = params.cursor === null || params.cursor === '' ? undefined : params.cursor;
    this.cursorLimit = params.limit;
    this.cursorDirection = params.direction ?? 'forward';
    this.cursorField = params.cursorField ?? 'id';
    this.cursorStrict = params.strict ?? false;
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

  /**
   * Merges raw `findMany` args, e.g. `cursor`, `distinct` or a custom `where`.
   * Values that are `undefined` are stripped at any depth, so
   * `custom({ distinct: undefined })` cannot overwrite an earlier value
   * (audit F15). A custom `where` is AND-ed with the `initialArgs` seed and any
   * previous custom `where` — it never replaces them (audit F2). Successive
   * custom `where`s may nest `{ AND: [...] }` groups; Prisma treats that
   * identically.
   */
  custom(args: FindManyArgsOf<D>): this {
    const { where, ...rest } = args as Record<string, unknown>;
    this.customArgs = { ...this.customArgs, ...deepStripUndefined(rest) };
    if (where !== undefined) {
      const cleaned = isPlainObject(where) ? deepStripUndefined(where) : where;
      const hasKeys = !isPlainObject(cleaned) || Object.keys(cleaned).length > 0;
      if (hasKeys) {
        this.customWhere = combineAnd([cleaned as object], this.customWhere);
      }
    }
    return this;
  }

  /** The fully assembled `findMany` args. Useful for debugging or reuse. */
  buildArgs(): FindManyArgsOf<D> {
    const args: Record<string, unknown> = { ...this.customArgs };

    const where = this.buildWhere();
    if (where) {
      args.where = where;
    }
    if (this.orderByArg) {
      args.orderBy = this.orderByArg;
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
      const page = this.page ?? 1;
      this.assertSkipCap(page, this.limit);
      const offset = toOffsetArgs(page, this.limit);
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
   *
   * Pass `{ includeTotal: false }` to skip the `COUNT` query entirely — `meta`
   * then carries `total: null` / `totalPage: null` (audit G3).
   *
   * Throws when cursor pagination is configured — offset meta cannot describe a
   * seek query, and the cursor over-fetch row would leak into `data` (audit F1).
   * Use {@link executeWithCursor} instead.
   */
  async executeWithMeta<O extends { includeTotal?: boolean } = { includeTotal?: boolean }>(
    opts?: O,
  ): Promise<{ meta: MetaOf<O>; data: FindResultOf<D, TArgs> }> {
    if (this.cursorActive) {
      throw new Error(
        'executeWithMeta() is offset-mode only: this builder has cursor pagination ' +
          'configured via cursorPaginate(). Use executeWithCursor() instead.',
      );
    }
    if (this.limit === undefined) {
      this.paginate({ page: 1, limit: DEFAULT_PAGE_SIZE });
    }
    // Fail before the COUNT goes out (strictNumbers + skip cap, audit F18).
    this.assertSkipCap(this.page ?? 1, this.limit ?? DEFAULT_PAGE_SIZE);
    const offset = toOffsetArgs(this.page ?? 1, this.limit ?? DEFAULT_PAGE_SIZE);

    if (opts?.includeTotal === false) {
      const data = await this.execute();
      return {
        meta: { page: offset.page, limit: offset.limit, total: null, totalPage: null },
        data,
      } as { meta: MetaOf<O>; data: FindResultOf<D, TArgs> };
    }

    const [total, data] = await Promise.all([this.count(), this.execute()]);

    return {
      meta: buildPaginationMeta(total, offset.page, offset.limit),
      data,
    } as { meta: MetaOf<O>; data: FindResultOf<D, TArgs> };
  }

  /**
   * Executes a cursor-paginated query (see {@link cursorPaginate}) and returns
   * the page rows plus `next`/`prev` cursors. Rows are always returned in the
   * configured sort order, regardless of pagination `direction`.
   *
   * Throws when a `.select()` projection drops `cursorField` — the page cursors
   * are derived from that field and would come out as `undefined` (audit F5).
   */
  async executeWithCursor(): Promise<{ meta: CursorMeta; data: FindResultOf<D, TArgs> }> {
    if (!this.cursorActive) {
      this.cursorPaginate({});
    }
    this.assertCursorFieldProjected();
    const limit = this.cursorLimit ?? DEFAULT_PAGE_SIZE;
    const hadCursor = this.cursor !== undefined;

    const findMany = this.delegate.findMany.bind(this.delegate) as unknown as (
      args: object,
    ) => Promise<Record<string, unknown>[]>;
    const rows = await findMany(this.buildArgs());

    // Strict mode spends one extra 1-row probe query to make the optimistic
    // opposite edge exact (audit F10 / G9): forward pages probe the row before
    // the cursor, backward pages the row after it. The probe mirrors the main
    // query's `where`/`orderBy` — Prisma positions the cursor within the
    // query's own sort order and filters.
    let exactFlags: ExactCursorFlags | undefined;
    if (this.cursorStrict && hadCursor) {
      const probeArgs: Record<string, unknown> = {
        take: this.cursorDirection === 'forward' ? -1 : 1,
        cursor: { [this.cursorField]: this.cursor },
        skip: 1,
      };
      const where = this.buildWhere();
      if (where) {
        probeArgs.where = where;
      }
      if (this.orderByArg) {
        probeArgs.orderBy = this.orderByArg;
      }
      const probe = await findMany(probeArgs);
      const hasEdgeRow = probe.length > 0;
      exactFlags =
        this.cursorDirection === 'forward'
          ? { hasPrevPage: hasEdgeRow }
          : { hasNextPage: hasEdgeRow };
    }

    const { data, meta } = buildCursorPage(rows, {
      limit,
      direction: this.cursorDirection,
      cursorField: this.cursorField,
      hadCursor,
      exactFlags,
    });

    return { meta, data: data as unknown as FindResultOf<D, TArgs> };
  }

  /** strictNumbers: out-of-range limits throw instead of clamping (audit F12). */
  private assertLimit(limit: number | undefined): void {
    if (!this.strictNumbers || limit === undefined) {
      return;
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new Error(
        `strictNumbers: limit ${String(limit)} is outside [1, ${String(MAX_PAGE_SIZE)}].`,
      );
    }
  }

  private assertPage(page: number | undefined): void {
    if (!this.strictNumbers || page === undefined) {
      return;
    }
    if (!Number.isFinite(page) || page < 1) {
      throw new Error(`strictNumbers: page ${String(page)} must be a finite number >= 1.`);
    }
  }

  /** strictNumbers: a computed skip beyond MAX_SKIP throws (audit F18). */
  private assertSkipCap(page: number, limit: number): void {
    if (!this.strictNumbers) {
      return;
    }
    const skip = (clampPage(page) - 1) * clampLimit(limit);
    if (skip > MAX_SKIP) {
      throw new Error(
        `strictNumbers: computed skip ${String(skip)} exceeds the ${String(MAX_SKIP)} cap — ` +
          'use cursor pagination for deep pages.',
      );
    }
  }

  /** A projection without the cursor field would derive cursors from `undefined` (audit F5). */
  private assertCursorFieldProjected(): void {
    // `.custom({ select })` also feeds args.select when no `.select()` ran.
    const select = (this.selectArg ?? this.customArgs.select) as
      Record<string, unknown> | undefined;
    if (select && !select[this.cursorField]) {
      throw new Error(
        `executeWithCursor(): the projection drops cursorField "${this.cursorField}", so page ` +
          'cursors would be built from undefined. Keep the field in .select() or remove the projection.',
      );
    }
  }

  private buildWhere(): object | undefined {
    return combineAnd(this.andConditions, this.customWhere);
  }
}
