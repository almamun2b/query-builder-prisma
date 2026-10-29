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
import type { PrismaModelDelegate, RowElementOf } from './delegate';

/** Keys of a select/include spec that are "on" (`true` or a nested spec). */
type TruthyKeys<S> = {
  [K in keyof S]-?: NonNullable<S[K]> extends false ? never : K;
}[keyof S];

/**
 * Apply a `select` spec to a row: only selected fields remain, nested selects
 * recurse into relation element types.
 */
export type ApplySelect<Row, S> = {
  [K in TruthyKeys<S> & keyof Row]: ProjectField<Row[K], S[K]>;
};

/**
 * Apply an `include` spec to a row: all base fields stay, included relations are
 * projected (recursively when the include carries a nested `select`), and a
 * truthy `_count` widens in as `Record<string, number>` (audit F9 — the engine
 * cannot know the selected relation keys, so it degrades wide, never wrong).
 */
export type ApplyInclude<Row, I> = Row & {
  [K in TruthyKeys<I> & (keyof Row | '_count')]: K extends '_count'
    ? Record<string, number>
    : ProjectField<Row[K & keyof Row], I[K]>;
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
type ProjectNested<Field, Sub> =
  Field extends readonly (infer E)[]
    ? ApplySelect<E, Sub>[]
    :
        | ApplySelect<NonNullable<Field>, Sub>
        | (undefined extends Field ? undefined : never)
        | (null extends Field ? null : never);

/**
 * Project a relation field through an `include`. Unlike select, include keeps
 * the relation's own fields — the element is intersected with its projection
 * via `ApplyInclude` (audit F3). Lists map over their element; optionality is
 * preserved exactly.
 */
type ProjectNestedInclude<Field, Sub> =
  Field extends readonly (infer E)[]
    ? ApplyInclude<E, Sub>[]
    :
        | ApplyInclude<NonNullable<Field>, Sub>
        | (undefined extends Field ? undefined : never)
        | (null extends Field ? null : never);

/**
 * The row shape produced by a `findMany` call with the given accumulated args.
 * With no `select`/`include`, this is the full model row (identity).
 */
export type ApplyProjection<Row, TArgs> = TArgs extends { select: infer S }
  ? ApplySelect<Row, S>
  : TArgs extends { include: infer I }
    ? ApplyInclude<Row, I>
    : Row;

/** The array a builder's `execute()` resolves to for the given delegate + args. */
export type FindResultOf<D extends PrismaModelDelegate, TArgs> = ApplyProjection<
  RowElementOf<D>,
  TArgs
>[];
