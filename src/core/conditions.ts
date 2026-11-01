/** Build-time condition assembly helpers used by the QueryBuilder core. */

/**
 * Keys we refuse to build into queries: assigning `'__proto__'` would set a prototype instead of
 * an own property (reachable via JSON-parsed request bodies). A refused key THROWS - silently
 * dropping it would turn a restricted query into a wider one.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function assertSafeKey(key: string): void {
  if (DANGEROUS_KEYS.has(key)) {
    throw new Error(
      `Refused key "${key}": it can pollute object prototypes. Remove it from the input ` +
        '(filters, ranges, sort paths and custom args) instead of passing user data through unchecked.',
    );
  }
}

/** Strip `undefined` values so optional query params can be passed directly. */
export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    assertSafeKey(key);
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Recursive {@link stripUndefined}: rebuilds plain objects and arrays of plain
 * objects without `undefined` values at any depth. Values that are not plain
 * objects (Date, BigInt, class instances like Decimal) pass through untouched
 * and the input is never mutated. Used by `.custom()` so a later
 * `custom({ key: undefined })` cannot overwrite an earlier value.
 */
export function deepStripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    assertSafeKey(key);
    if (value === undefined) {
      continue;
    }
    result[key] = isDeepStrippable(value)
      ? deepStripUndefined(value)
      : Array.isArray(value)
        ? value.map((item) => (isDeepStrippable(item) ? deepStripUndefined(item) : item))
        : value;
  }
  return result;
}

/** True for objects we may rebuild when deep-stripping (prototype-owned only). */
function isDeepStrippable(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** True for plain objects (not arrays, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Expand `'avatar.size'` + a leaf value into `{ avatar: { size: leaf } }`.
 * Empty segments are skipped (a path of only empty segments expands to `{}`); a path
 * containing a `__proto__`/`constructor`/`prototype` segment throws.
 */
export function expandDotPath(path: string, leaf: unknown): Record<string, unknown> {
  const keys = path.split('.').filter((key) => key.length > 0);
  keys.forEach(assertSafeKey);
  if (keys.length === 0) {
    return {};
  }
  let current: unknown = leaf;
  for (let i = keys.length - 1; i >= 0; i--) {
    const key = keys[i];
    if (key === undefined) {
      continue;
    }
    current = { [key]: current };
  }
  return current as Record<string, unknown>;
}

/**
 * AND-combine accumulated conditions with an optional seeded `where`.
 * A single condition is returned unwrapped (semantically identical to an
 * `AND` of one); zero conditions yields `undefined` (no `where` at all).
 */
export function combineAnd(
  conditions: readonly object[],
  customWhere?: unknown,
): object | undefined {
  const all: object[] = isPlainObject(customWhere) ? [customWhere, ...conditions] : [...conditions];
  if (all.length === 0) {
    return undefined;
  }
  if (all.length === 1) {
    return all[0];
  }
  return { AND: all };
}
