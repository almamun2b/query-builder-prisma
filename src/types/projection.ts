/**
 * Structural projection engine (ARCHITECTURE.md, invariant 3).
 *
 * Narrows the output type of `findMany` according to the accumulated
 * `select`/`include` arguments — without importing a single Prisma type.
 * Everything is derived from the model's own row type, which already encodes
 * relation shapes, so this works on every Prisma version.
 *
 * Degradation rule: when Prisma's exact semantics can't be mirrored, the result
 * is the *wider but correct* type — never a wrong one.
 */
import type { FindManyArgsOf, PrismaModelDelegate, RowElementOf } from './delegate';

/** Keys of a select/include spec that are "on" (`true`, a nested spec or a non-literal boolean). */
type TruthyKeys<S> = {
  [K in keyof S]-?: NonNullable<S[K]> extends false ? never : K;
}[keyof S];

/**
 * True when a spec flag certainly selects its key: it can be neither `false` nor
 * `undefined`. A non-literal `boolean` (e.g. a value typed as Prisma's own `UserSelect`)
 * may or may not select, so the key is optional in the result.
 */
type IsDefinite<V> = undefined extends V ? false : false extends V ? false : true;

type DefiniteKeys<S> = {
  [K in TruthyKeys<S>]: IsDefinite<S[K & keyof S]> extends true ? K : never;
}[TruthyKeys<S>];

type MaybeKeys<S> = Exclude<TruthyKeys<S>, DefiniteKeys<S>>;

/** Flatten an intersection into one object type (keeps modifiers, keeps `Equal<>` strict). */
type Simplify<T> = { [K in keyof T]: T[K] };

/**
 * The value of one selected/included key. Keys on the row are projected through their
 * spec. `_count` is not a row field in Prisma but is a valid key: it widens in as
 * `Record<string, number>` (the engine cannot know the counted relation keys). Any other key
 * is a relation the row type does not describe - Prisma's generic `findMany` resolves to the
 * scalar-only default row - so it degrades to `unknown` (wider, never dropped).
 */
type KeyValue<Row, S, K> = K extends keyof Row
  ? ProjectField<Row[K], S[K & keyof S]>
  : K extends '_count'
    ? Record<string, number>
    : unknown;

/**
 * Apply a `select` spec to a row: only selected fields remain, nested selects
 * recurse into relation element types. Keys flagged with a non-literal `boolean`
 * are optional.
 */
export type ApplySelect<Row, S> = Simplify<
  { [K in DefiniteKeys<S>]: KeyValue<Row, S, K> } & { [K in MaybeKeys<S>]?: KeyValue<Row, S, K> }
>;

/**
 * Apply an `include` spec to a row: all base fields stay and included relations are
 * projected (recursively when the include carries a nested `select`). Same key rules as
 * {@link ApplySelect}.
 */
export type ApplyInclude<Row, I> = [MaybeKeys<I>] extends [never]
  ? Row & { [K in DefiniteKeys<I>]: KeyValue<Row, I, K> }
  : Row & { [K in DefiniteKeys<I>]: KeyValue<Row, I, K> } & {
      [K in MaybeKeys<I>]?: KeyValue<Row, I, K>;
    };

/** Project one field (`Field`) according to its select/include `Spec`. */
type ProjectField<Field, Spec> = Spec extends true
  ? Field
  : Spec extends { select: infer Sub }
    ? ProjectNested<Field, Sub>
    : Spec extends { include: infer Sub }
      ? ProjectNestedInclude<Field, Sub>
      : Field;

/**
 * Project a relation field through a `select`. Only the selected keys remain.
 * Lists map over their element; optionality (`| null | undefined`) is preserved
 * exactly.
 */
type ProjectNested<Field, Sub> = Field extends readonly (infer E)[]
  ? ApplySelect<E, Sub>[]
  : | ApplySelect<NonNullable<Field>, Sub>
    | (undefined extends Field ? undefined : never)
    | (null extends Field ? null : never);

/**
 * Project a relation field through an `include`. Unlike select, include keeps
 * the relation's own fields — the element is intersected with its projection
 * via `ApplyInclude`. Lists map over their element; optionality is
 * preserved exactly.
 */
type ProjectNestedInclude<Field, Sub> = Field extends readonly (infer E)[]
  ? ApplyInclude<E, Sub>[]
  : | ApplyInclude<NonNullable<Field>, Sub>
    | (undefined extends Field ? undefined : never)
    | (null extends Field ? null : never);

/**
 * The row shape produced by a `findMany` call with the given accumulated args.
 * With no `select`/`include`, this is the full model row (identity).
 *
 * Precedence mirrors the runtime: an explicit `.select()`/`.include()` (`select`/`include`
 * in `TArgs`) always beats a projection that arrived through `.custom()`
 * (`customSelect`/`customInclude`).
 */
export type ApplyProjection<Row, TArgs> = TArgs extends { select: infer S }
  ? ApplySelect<Row, S>
  : TArgs extends { include: infer I }
    ? ApplyInclude<Row, I>
    : TArgs extends { customSelect: infer S }
      ? ApplySelect<Row, S>
      : TArgs extends { customInclude: infer I }
        ? ApplyInclude<Row, I>
        : Row;

/** The array a builder's `execute()` resolves to for the given delegate + args. */
export type FindResultOf<D extends PrismaModelDelegate, TArgs> = ApplyProjection<
  RowElementOf<D>,
  TArgs
>[];

/**
 * The `select`/`include` part of the accumulated args, as Prisma's own `findMany` expects it.
 * Intersected into {@link QueryBuilder.buildArgs} so that `prisma.user.findMany(qb.buildArgs())`
 * infers the exact native result type. Mirrors {@link ApplyProjection}'s precedence.
 */
export type ProjectionArgs<TArgs> = TArgs extends { select: infer S }
  ? { select: S }
  : TArgs extends { include: infer I }
    ? { include: I }
    : TArgs extends { customSelect: infer S }
      ? { select: S }
      : TArgs extends { customInclude: infer I }
        ? { include: I }
        : unknown;

/**
 * Return type of {@link QueryBuilder.buildArgs}: the delegate's own `findMany` args with the
 * tracked `select`/`include` replacing the wide optional ones. Keeping both would leave Prisma's
 * result type seeing an optional `select`/`include` next to the literal one and over-claim fields.
 */
export type BuiltArgsOf<D extends PrismaModelDelegate, TArgs> =
  unknown extends ProjectionArgs<TArgs>
    ? FindManyArgsOf<D>
    : Omit<FindManyArgsOf<D>, 'select' | 'include'> & ProjectionArgs<TArgs>;
