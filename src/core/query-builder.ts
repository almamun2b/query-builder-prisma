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
import type { ApplyProjection, BuiltArgsOf, FindResultOf } from '../types/projection';
import type {
  CursorDirection,
  CursorMeta,
  CursorType,
  CursorValue,
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
  coerceCursor,
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
   * `MAX_SKIP`. Defaults to clamping.
   */
  strictNumbers?: boolean | undefined;
}

/**
 * Meta type of {@link QueryBuilder.executeWithMeta} for the given options. A flag that is only
 * known to be a `boolean` at compile time can produce either shape, so the result is the union.
 */
type MetaOf<O extends { includeTotal?: boolean }> = 'includeTotal' extends keyof O
  ? [O['includeTotal']] extends [false]
    ? PaginationMetaNoTotal
    : [O['includeTotal']] extends [true | undefined]
      ? PaginationMeta
      : PaginationMeta | PaginationMetaNoTotal
  : PaginationMeta;

/** `TArgs` without any projection: explicit `select`/`include` and `custom()`-sourced ones. */
type ExplicitProjection<TArgs> = Omit<
  TArgs,
  'select' | 'include' | 'customSelect' | 'customInclude'
>;

/**
 * `TArgs` after `.custom(C)`, mirroring `resolveProjection()`: a literal `select`/`include` in `C`
 * is tracked only when no explicit `.select()`/`.include()` exists (explicit methods win at
 * runtime). Among `custom()` calls a `select` beats an `include` regardless of order, a later
 * call of the same kind replaces the earlier one, and an `undefined`/`null` value changes nothing.
 */
type WithCustom<TArgs, C> = TArgs extends { select: unknown } | { include: unknown }
  ? TArgs
  : C extends { select: infer S }
    ? [NonNullable<S>] extends [never]
      ? WithCustomInclude<TArgs, C>
      : Omit<TArgs, 'customSelect' | 'customInclude'> & { customSelect: NonNullable<S> }
    : WithCustomInclude<TArgs, C>;

type WithCustomInclude<TArgs, C> = C extends { include: infer I }
  ? [NonNullable<I>] extends [never]
    ? TArgs
    : TArgs extends { customSelect: unknown }
      ? TArgs
      : Omit<TArgs, 'customSelect' | 'customInclude'> & { customInclude: NonNullable<I> }
  : TArgs;

/** Resolved pagination handed to `compose()`; keeps the execute methods free of state writes. */
type Paging = OffsetPaging | CursorPaging;

interface OffsetPaging {
  kind: 'offset';
  page: number;
  limit: number;
}

interface CursorPaging {
  kind: 'cursor';
  cursor: CursorValue | undefined;
  limit: number | undefined;
  direction: CursorDirection;
  field: string;
  strict: boolean;
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
   * seed instead of replacing it (the seed carries safety filters).
   */
  private customWhere: unknown;
  /**
   * `select`/`include` from the `initialArgs` seed and `.custom()`. Kept apart from the explicit
   * `.select()`/`.include()` so {@link resolveProjection} can apply one fixed precedence and
   * never emit both keys (Prisma rejects `select` together with `include`).
   */
  private customSelect: object | undefined;
  private customInclude: object | undefined;
  private orderByArg: object | undefined;
  private selectArg: object | undefined;
  private includeArg: object | undefined;
  private page: number | undefined;
  private limit: number | undefined;
  private cursorActive = false;
  private cursor: CursorValue | undefined;
  private cursorLimit: number | undefined;
  private cursorDirection: CursorDirection = 'forward';
  private cursorField: string = 'id';
  private cursorStrict = false;

  /**
   * @param delegate - The Prisma delegate to query (e.g. `prisma.user`).
   * @param options - Optional seed args, a dialect override, or `strictNumbers`.
   */
  constructor(delegate: D, options?: QueryBuilderOptions<D>) {
    this.delegate = delegate;
    this.dialect = options?.dialect;
    this.strictNumbers = options?.strictNumbers ?? false;
    if (options?.initialArgs) {
      const { where, select, include, ...rest } = options.initialArgs as Record<string, unknown>;
      this.customArgs = { ...rest };
      this.customWhere = where;
      this.customSelect = (select ?? undefined) as object | undefined;
      this.customInclude = (include ?? undefined) as object | undefined;
    }
  }

  /**
   * Case-insensitive `contains` across the provided string fields. No condition
   * is added when `searchText` is empty or whitespace-only.
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
          // One match object per arm — never a shared reference.
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
    const cleaned = stripUndefined(condition as Record<string, unknown>);
    if (Object.keys(cleaned).length > 0) {
      this.andConditions.push(cleaned);
    }
    return this;
  }

  /**
   * Sets `orderBy` from a single key. No-op when `sortBy` is not provided.
   * Dot paths expand like `.range()` (`'avatar.size'` → `{ avatar: { size } }`).
   * For multi-key or nested relation sorts use {@link orderBy}.
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
   * convenience — the latest of the two calls wins.
   */
  orderBy(order: OrderByOf<D>): this {
    this.orderByArg = order as object;
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
   *   page (omit it for the first page). Strings, numbers, bigints and Dates are
   *   accepted; Dates serialize to ISO-8601 in the returned cursors.
   * - `cursorType` converts `cursor` to the type of `cursorField` before it reaches
   *   Prisma: the returned `meta` cursors are strings, and Prisma rejects a string for an
   *   `Int`/`BigInt`/`DateTime` field, so pass `'number'`, `'bigint'` or `'date'` when the
   *   cursor comes back from a query string. Default `'string'` = pass through unchanged.
   *   An unconvertible cursor throws here, before any query is sent.
   * - `direction` walks `'forward'` (next) or `'backward'` (previous).
   * - `cursorField` is the unique, sequential column to seek on (default `id`).
   *   Pair it with a matching {@link sortBy} for stable ordering.
   * - `strict` spends one extra 1-row probe query to make `hasNextPage` /
   *   `hasPrevPage` exact instead of optimistic.
   *
   * Takes precedence over {@link paginate} when both are set.
   */
  cursorPaginate(params: {
    cursor?: CursorValue | undefined;
    cursorType?: CursorType;
    limit?: number;
    direction?: CursorDirection;
    cursorField?: OrderKeyOf<D> | (string & {});
    strict?: boolean;
  }): this {
    this.assertLimit(params.limit);
    this.cursorActive = true;
    this.cursor = coerceCursor(params.cursor, params.cursorType ?? 'string');
    this.cursorLimit = params.limit;
    this.cursorDirection = params.direction ?? 'forward';
    this.cursorField = params.cursorField ?? 'id';
    this.cursorStrict = params.strict ?? false;
    return this;
  }

  /**
   * Returns an independent copy of this builder: same filters, sorting, pagination, custom args,
   * projection and cursor settings, sharing no mutable state. Use it to branch one base query
   * into several (`base.clone().filter(...)`). {@link select}, {@link include} and a
   * {@link custom} call carrying a projection clone for you.
   */
  clone(): QueryBuilder<D, TArgs> {
    const copy = new QueryBuilder<D, TArgs>(this.delegate, {
      dialect: this.dialect,
      strictNumbers: this.strictNumbers,
    });
    copy.andConditions.push(...this.andConditions);
    copy.customArgs = { ...this.customArgs };
    copy.customWhere = this.customWhere;
    copy.customSelect = this.customSelect;
    copy.customInclude = this.customInclude;
    copy.orderByArg = this.orderByArg;
    copy.selectArg = this.selectArg;
    copy.includeArg = this.includeArg;
    copy.page = this.page;
    copy.limit = this.limit;
    copy.cursorActive = this.cursorActive;
    copy.cursor = this.cursor;
    copy.cursorLimit = this.cursorLimit;
    copy.cursorDirection = this.cursorDirection;
    copy.cursorField = this.cursorField;
    copy.cursorStrict = this.cursorStrict;
    return copy;
  }

  /**
   * Projects fields with Prisma `select`. The result type of `execute()` is
   * narrowed to exactly the selected shape. Clears any active `.include()`.
   *
   * Returns a NEW builder (the type changes, so the original must not alias it): keep using
   * the returned value. The builder you called it on is left untouched.
   */
  select<TSelect extends SelectOf<D>>(
    select: TSelect,
  ): QueryBuilder<D, ExplicitProjection<TArgs> & { select: TSelect }> {
    const next = this.clone();
    next.selectArg = select;
    next.includeArg = undefined;
    return next as unknown as QueryBuilder<D, ExplicitProjection<TArgs> & { select: TSelect }>;
  }

  /**
   * Eager-loads relations with Prisma `include`. The result type of `execute()`
   * is widened with the included relations. Clears any active `.select()`.
   *
   * Returns a NEW builder, like {@link select}: keep using the returned value.
   */
  include<TInclude extends IncludeOf<D>>(
    include: TInclude,
  ): QueryBuilder<D, ExplicitProjection<TArgs> & { include: TInclude }> {
    const next = this.clone();
    next.includeArg = include;
    next.selectArg = undefined;
    return next as unknown as QueryBuilder<D, ExplicitProjection<TArgs> & { include: TInclude }>;
  }

  /**
   * Merges raw `findMany` args, e.g. `cursor`, `distinct` or a custom `where`.
   * Values that are `undefined` are stripped at any depth, so
   * `custom({ distinct: undefined })` cannot overwrite an earlier value. A
   * custom `where` is AND-ed with the `initialArgs` seed and any
   * previous custom `where` — it never replaces them. Successive
   * custom `where`s may nest `{ AND: [...] }` groups; Prisma treats that
   * identically.
   *
   * A literal `select`/`include` in `args` also narrows the result type (an explicit
   * `.select()`/`.include()` still wins). Like {@link select}, a call that carries one returns a
   * NEW builder because the type changes; any other call mutates and returns `this`.
   */
  custom<C extends FindManyArgsOf<D>>(args: C): QueryBuilder<D, WithCustom<TArgs, C>> {
    const { where, select, include, ...rest } = args as Record<string, unknown>;
    const hasProjection =
      (select !== undefined && select !== null) || (include !== undefined && include !== null);
    const target = hasProjection ? this.clone() : this;

    target.customArgs = { ...target.customArgs, ...deepStripUndefined(rest) };
    if (select !== undefined && select !== null) {
      target.customSelect = deepStripUndefined(select as Record<string, unknown>);
    }
    if (include !== undefined && include !== null) {
      target.customInclude = deepStripUndefined(include as Record<string, unknown>);
    }
    if (where !== undefined) {
      const cleaned = isPlainObject(where) ? deepStripUndefined(where) : where;
      const hasKeys = !isPlainObject(cleaned) || Object.keys(cleaned).length > 0;
      if (hasKeys) {
        target.customWhere = combineAnd([cleaned as object], target.customWhere);
      }
    }
    return target as unknown as QueryBuilder<D, WithCustom<TArgs, C>>;
  }

  /** The fully assembled `findMany` args. Useful for debugging or reuse. */
  buildArgs(): BuiltArgsOf<D, TArgs> {
    return this.compose(this.currentPaging()) as BuiltArgsOf<D, TArgs>;
  }

  /**
   * Executes the query and returns the rows, typed from `.select()`/`.include()`.
   *
   * Tip: for 100% Prisma-native inference you can always run the passthrough
   * `prisma.user.findMany(qb.buildArgs())` — same args, Prisma's own overloads.
   */
  async execute(): Promise<FindResultOf<D, TArgs>> {
    return (await this.callFindMany(this.buildArgs())) as FindResultOf<D, TArgs>;
  }

  /** Executes the query and returns the first row, or `null` when none matched. */
  async first(): Promise<ApplyProjection<RowElementOf<D>, TArgs> | null> {
    const args = this.compose(undefined);
    args.take = 1;
    delete args.skip;
    delete args.cursor;
    const rows = (await this.callFindMany(args)) as unknown[];
    return (rows[0] ?? null) as ApplyProjection<RowElementOf<D>, TArgs> | null;
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
    return this.callCount(this.buildWhere());
  }

  /**
   * Executes the query and returns the rows plus offset pagination metadata.
   * When no pagination was configured, defaults to page 1, limit 10 so `meta`
   * always describes the data actually returned - without changing the builder.
   * `count` and `findMany` run in parallel.
   *
   * Pass `{ includeTotal: false }` to skip the `COUNT` query entirely — `meta`
   * then carries `total: null` / `totalPage: null`.
   *
   * Throws when cursor pagination is configured — offset meta cannot describe a
   * seek query, and the cursor over-fetch row would leak into `data`.
   * Use {@link executeWithCursor} instead.
   */
  async executeWithMeta(): Promise<{ meta: PaginationMeta; data: FindResultOf<D, TArgs> }>;
  async executeWithMeta<O extends { includeTotal?: boolean }>(
    opts: O,
  ): Promise<{ meta: MetaOf<O>; data: FindResultOf<D, TArgs> }>;
  async executeWithMeta(opts?: {
    includeTotal?: boolean;
  }): Promise<{ meta: PaginationMeta | PaginationMetaNoTotal; data: FindResultOf<D, TArgs> }> {
    if (this.cursorActive) {
      throw new Error(
        'executeWithMeta() is offset-mode only: this builder has cursor pagination ' +
          'configured via cursorPaginate(). Use executeWithCursor() instead.',
      );
    }
    const page = this.page ?? 1;
    const limit = this.limit ?? DEFAULT_PAGE_SIZE;
    // Fail before the COUNT goes out (strictNumbers + skip cap).
    this.assertSkipCap(page, limit);
    const offset = toOffsetArgs(page, limit);
    const args = this.compose({ kind: 'offset', page, limit });

    if (opts?.includeTotal === false) {
      const data = (await this.callFindMany(args)) as FindResultOf<D, TArgs>;
      return {
        meta: { page: offset.page, limit: offset.limit, total: null, totalPage: null },
        data,
      };
    }

    const [total, data] = await Promise.all([
      this.callCount(this.buildWhere()),
      this.callFindMany(args) as Promise<FindResultOf<D, TArgs>>,
    ]);
    return { meta: buildPaginationMeta(total, offset.page, offset.limit), data };
  }

  /**
   * Executes a cursor-paginated query (see {@link cursorPaginate}) and returns
   * the page rows plus `next`/`prev` cursors. Rows are always returned in the
   * configured sort order, regardless of pagination `direction`. Without a
   * prior `cursorPaginate()` call it starts at the first page, using the
   * `paginate()` limit when one was set (default 10) - the builder is not modified.
   *
   * Throws when a `.select()` projection drops `cursorField` — the page cursors
   * are derived from that field and would come out as `undefined`.
   */
  async executeWithCursor(): Promise<{ meta: CursorMeta; data: FindResultOf<D, TArgs> }> {
    const paging = this.cursorPaging();
    this.assertCursorFieldProjected(paging.field);
    const hadCursor = paging.cursor !== undefined;
    const mainArgs = this.compose(paging);

    // Strict mode spends one extra 1-row probe query to make the optimistic
    // opposite edge exact: forward pages probe the row before the cursor,
    // backward pages the row after it. The probe is the main query with the
    // seek replaced, so it inherits `where`, `orderBy` and `distinct` from every
    // source - Prisma positions the cursor within the query's own order and
    // filters - and fetches only the cursor field. It runs in parallel.
    let probeArgs: Record<string, unknown> | undefined;
    if (paging.strict && hadCursor) {
      probeArgs = {
        ...mainArgs,
        take: paging.direction === 'forward' ? -1 : 1,
        cursor: { [paging.field]: paging.cursor },
        skip: 1,
        select: { [paging.field]: true },
      };
      delete probeArgs.include;
      delete probeArgs.omit;
    }

    const [rows, probe] = await Promise.all([
      this.callFindMany(mainArgs) as Promise<Record<string, unknown>[]>,
      probeArgs ? (this.callFindMany(probeArgs) as Promise<unknown[]>) : undefined,
    ]);

    let exactFlags: ExactCursorFlags | undefined;
    if (probe) {
      const hasEdgeRow = probe.length > 0;
      exactFlags =
        paging.direction === 'forward' ? { hasPrevPage: hasEdgeRow } : { hasNextPage: hasEdgeRow };
    }

    const { data, meta } = buildCursorPage(rows, {
      limit: paging.limit ?? DEFAULT_PAGE_SIZE,
      direction: paging.direction,
      cursorField: paging.field,
      hadCursor,
      exactFlags,
    });

    return { meta, data: data as unknown as FindResultOf<D, TArgs> };
  }

  /** The pagination the builder is configured for, if any (state is read, never written). */
  private currentPaging(): Paging | undefined {
    if (this.cursorActive) {
      return this.cursorPaging();
    }
    if (this.limit !== undefined) {
      return { kind: 'offset', page: this.page ?? 1, limit: this.limit };
    }
    return undefined;
  }

  /**
   * Cursor settings. Without `cursorPaginate()` this is the first page with defaults; the
   * `paginate()` limit is honoured as the page size when no cursor limit was given.
   */
  private cursorPaging(): CursorPaging {
    return {
      kind: 'cursor',
      cursor: this.cursorActive ? this.cursor : undefined,
      limit: this.cursorLimit ?? this.limit,
      direction: this.cursorActive ? this.cursorDirection : 'forward',
      field: this.cursorActive ? this.cursorField : 'id',
      strict: this.cursorActive ? this.cursorStrict : false,
    };
  }

  /** Folds the builder state plus an explicit paging plan into `findMany` args (fresh object). */
  private compose(paging: Paging | undefined): Record<string, unknown> {
    const args: Record<string, unknown> = { ...this.customArgs };

    const where = this.buildWhere();
    if (where) {
      args.where = where;
    }
    if (this.orderByArg) {
      args.orderBy = this.orderByArg;
    }
    Object.assign(args, this.resolveProjection());

    if (paging?.kind === 'cursor') {
      // Cursor mode owns cursor/skip/take: raw `custom()` leftovers must not leak in.
      delete args.cursor;
      delete args.skip;
      const cursorArgs = toCursorArgs({
        cursor: paging.cursor,
        limit: paging.limit,
        direction: paging.direction,
        cursorField: paging.field,
      });
      args.take = cursorArgs.take;
      if (cursorArgs.cursor) {
        args.cursor = cursorArgs.cursor;
      }
      if (cursorArgs.skip !== undefined) {
        args.skip = cursorArgs.skip;
      }
    } else if (paging?.kind === 'offset') {
      this.assertSkipCap(paging.page, paging.limit);
      const offset = toOffsetArgs(paging.page, paging.limit);
      args.take = offset.take;
      args.skip = offset.skip;
    }

    return args;
  }

  private callFindMany(args: object): Promise<unknown> {
    const findMany = this.delegate.findMany as unknown as (args: object) => Promise<unknown>;
    return findMany.call(this.delegate, args);
  }

  private callCount(where: object | undefined): Promise<number> {
    const count = this.delegate.count as unknown as (args: object) => Promise<number>;
    return count.call(this.delegate, where ? { where } : {});
  }

  /** strictNumbers: out-of-range limits throw instead of clamping. */
  private assertLimit(limit: number | undefined): void {
    if (!this.strictNumbers || limit === undefined) {
      return;
    }
    if (!Number.isFinite(limit) || limit < 1 || limit > MAX_PAGE_SIZE) {
      throw new Error(`strictNumbers: limit ${String(limit)} is outside [1, ${MAX_PAGE_SIZE}].`);
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

  /** strictNumbers: a computed skip beyond MAX_SKIP throws. */
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

  /** A projection without the cursor field would derive cursors from `undefined`. */
  private assertCursorFieldProjected(field: string): void {
    const select = this.resolveProjection().select as Record<string, unknown> | undefined;
    const omit = this.customArgs.omit as Record<string, unknown> | undefined;
    if ((select && !select[field]) || omit?.[field] === true) {
      throw new Error(
        `executeWithCursor(): the projection drops cursorField "${field}", so page ` +
          'cursors would be built from undefined. Keep the field in .select() (or out of omit) or remove the projection.',
      );
    }
  }

  /**
   * The one projection that reaches Prisma. Precedence, independent of call order:
   * explicit `.select()` > explicit `.include()` > a `select` from `custom()`/`initialArgs`,
   * then an `include` from the same sources. Never both keys.
   */
  private resolveProjection(): { select?: object; include?: object } {
    if (this.selectArg) {
      return { select: this.selectArg };
    }
    if (this.includeArg) {
      return { include: this.includeArg };
    }
    if (this.customSelect) {
      return { select: this.customSelect };
    }
    if (this.customInclude) {
      return { include: this.customInclude };
    }
    return {};
  }

  private buildWhere(): object | undefined {
    return combineAnd(this.andConditions, this.customWhere);
  }
}
