import type { Dialect } from './capabilities';

/**
 * Best-effort dialect auto-detection (M2 scope).
 *
 * v0 intentionally detects nothing and returns `undefined` → callers fall
 * through to `'universal'`, which never emits an invalid argument on any
 * database. Future heuristics (guarded property sniffing of the Prisma client)
 * must keep the same contract: NEVER throw, NEVER guess wrong loudly — an
 * unknown dialect must degrade to `'universal'`, not to a wrong guess.
 *
 * Users who know their database should prefer explicit configuration:
 *   configureQueryBuilder({ dialect: 'postgres' })
 * or per builder:
 *   new QueryBuilder(prisma.user, { dialect: 'mongodb' })
 */
export function detectDialect(): Dialect | undefined {
  return undefined;
}
