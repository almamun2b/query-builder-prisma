/** Build-time condition assembly helpers used by the QueryBuilder core. */

/** Strip `undefined` values so optional query params can be passed directly. */
export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

/** True for plain objects (not arrays, not null). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Expand `'avatar.size'` + `{ gte }` into `{ avatar: { size: { gte } } }`. */
export function expandDotPath(path: string, leaf: object): Record<string, unknown> {
  const keys = path.split('.');
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
