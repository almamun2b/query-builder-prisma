/**
 * Structural contracts — the ONLY knowledge this package has about Prisma.
 *
 * Nothing here imports Prisma. Any object exposing `findMany` + `count` with the
 * standard Prisma delegate call shape satisfies these contracts — Prisma 5, 6, 7,
 * 8, and (per ARCHITECTURE.md, invariant 2) any future version that keeps its
 * public API.
 */

/**
 * Minimal structural contract every Prisma model delegate (e.g. `prisma.user`)
 * already satisfies. Used only as an upper bound so the concrete delegate type is
 * preserved at call sites while keeping our classes generic.
 */
export interface PrismaModelDelegate {
  findMany: (...args: never[]) => unknown;
  count: (...args: never[]) => unknown;
}

/** `findMany` arguments for the given delegate, derived from the delegate itself. */
export type FindManyArgsOf<D extends PrismaModelDelegate> = NonNullable<
  Parameters<D['findMany']>[0]
>;

/** `where` input of the model, derived from the delegate. */
export type WhereOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['where']>;

/** `select` input of the model, derived from the delegate. */
export type SelectOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['select']>;

/** `include` input of the model, derived from the delegate. */
export type IncludeOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['include']>;

/** Scalar/relation keys that can be referenced from a model's `where` input. */
export type WhereKeyOf<D extends PrismaModelDelegate> = keyof WhereOf<D> & string;

/** `orderBy` input of the model, derived from the delegate. */
export type OrderByOf<D extends PrismaModelDelegate> = NonNullable<FindManyArgsOf<D>['orderBy']>;

/** Keys that can be used to order a model's results. */
export type OrderKeyOf<D extends PrismaModelDelegate> =
  OrderByOf<D> extends infer O
    ? O extends readonly unknown[]
      ? keyof O[number] & string
      : keyof O & string
    : never;

/** The rows array `findMany` resolves to, derived from the delegate. */
export type RowsOf<D extends PrismaModelDelegate> = Awaited<ReturnType<D['findMany']>>;

/** A single row of the model, derived from the delegate. */
export type RowElementOf<D extends PrismaModelDelegate> =
  RowsOf<D> extends readonly (infer E)[] ? E : never;
