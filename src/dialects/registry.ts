import { DIALECT_CAPABILITIES } from './capabilities';
import type { DialectCapabilities } from './capabilities';

/*
 * Dialect registry (ARCHITECTURE.md, invariant 4).
 *
 * Resolution order (fails soft to 'universal', which is always valid):
 *   1. explicit per-builder override  new QueryBuilder(prisma.user, { dialect: 'mysql' })
 *   2. global config                  configureQueryBuilder({ dialect: 'postgres' })
 *   3. registered auto-detector       (see dialects/detect.ts)
 *   4. 'universal'
 */

const registry: Map<string, DialectCapabilities> = new Map(
  Object.entries(DIALECT_CAPABILITIES) as [string, DialectCapabilities][],
);

let globalDialect: string | undefined;
let dialectDetector: (() => string | undefined) | undefined;

/**
 * Register capabilities for a database - including ones Prisma adds in the
 * future. No core code changes are ever required to support a new dialect.
 */
export function registerDialect(name: string, capabilities: DialectCapabilities): void {
  registry.set(name, capabilities);
}

/** Set the global default dialect for all builders that do not override it. */
export function configureQueryBuilder(options: { dialect?: string | undefined }): void {
  globalDialect = options.dialect;
}

/**
 * Plug in an auto-detector (best-effort). It must never throw; an undefined
 * result simply falls through to 'universal'.
 */
export function setDialectDetector(detector: () => string | undefined): void {
  dialectDetector = detector;
}

/** A dialect name plus the capabilities resolved for it. */
export interface ResolvedDialect {
  name: string;
  capabilities: DialectCapabilities;
}

/** Resolve the active dialect per the documented precedence. */
export function resolveDialect(explicit?: string | undefined): ResolvedDialect {
  const name = explicit ?? globalDialect ?? dialectDetector?.() ?? 'universal';
  const capabilities = registry.get(name) ?? DIALECT_CAPABILITIES.universal;
  return { name, capabilities };
}

/** Test helper: reset global configuration. */
export function resetDialectConfig(): void {
  globalDialect = undefined;
  dialectDetector = undefined;
}
