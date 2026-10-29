import { DIALECT_CAPABILITIES } from './capabilities';
import type { DialectCapabilities } from './capabilities';
import { detectDialect } from './detect';

/*
 * Dialect registry (ARCHITECTURE.md, invariant 4).
 *
 * Resolution order (fails soft to 'universal', which is always valid):
 *   1. explicit per-builder override  new QueryBuilder(prisma.user, { dialect: 'mysql' })
 *   2. global config                  configureQueryBuilder({ dialect: 'postgres' })
 *   3. registered auto-detector       setDialectDetector(fn)
 *   4. built-in detector              detectDialect() (no-op in v0 — audit G2)
 *   5. 'universal'
 */

/** Mutable dialect state, shared via `globalThis` (audit F7). */
interface DialectState {
  registry: Map<string, DialectCapabilities>;
  globalDialect: string | undefined;
  detector: (() => string | undefined) | undefined;
}

/**
 * The state lives on `globalThis` under a registered symbol so ESM and CJS
 * copies of this package converge on ONE config — a bundler loading both
 * variants can no longer split the global dialect config (dual-package hazard,
 * audit F7). This is the only mutable module-adjacent state in the package;
 * prefer the per-builder `dialect` option anyway.
 */
const STATE_KEY = Symbol.for('query-builder-prisma.dialect-state');

function state(): DialectState {
  const host = globalThis as typeof globalThis & { [STATE_KEY]?: DialectState };
  return (host[STATE_KEY] ??= {
    registry: new Map(Object.entries(DIALECT_CAPABILITIES) as [string, DialectCapabilities][]),
    globalDialect: undefined,
    detector: undefined,
  });
}

/**
 * Register capabilities for a database - including ones Prisma adds in the
 * future. No core code changes are ever required to support a new dialect.
 */
export function registerDialect(name: string, capabilities: DialectCapabilities): void {
  state().registry.set(name, capabilities);
}

/** Set the global default dialect for all builders that do not override it. */
export function configureQueryBuilder(options: { dialect?: string | undefined }): void {
  state().globalDialect = options.dialect;
}

/**
 * Plug in an auto-detector (best-effort). It must never throw; an undefined
 * result simply falls through to the built-in detector and then 'universal'.
 */
export function setDialectDetector(detector: () => string | undefined): void {
  state().detector = detector;
}

/** A dialect name plus the capabilities resolved for it. */
export interface ResolvedDialect {
  name: string;
  capabilities: DialectCapabilities;
}

/**
 * Resolve the active dialect per the documented precedence. An unregistered
 * name resolves to `'universal'` — the reported name never lies about the
 * capabilities actually applied (audit G8).
 */
export function resolveDialect(explicit?: string | undefined): ResolvedDialect {
  const s = state();
  const requested = explicit ?? s.globalDialect ?? s.detector?.() ?? detectDialect() ?? 'universal';
  const capabilities = s.registry.get(requested);
  return capabilities
    ? { name: requested, capabilities }
    : { name: 'universal', capabilities: DIALECT_CAPABILITIES.universal };
}

/** Test helper: reset global configuration (registry entries are kept). */
export function resetDialectConfig(): void {
  const s = state();
  s.globalDialect = undefined;
  s.detector = undefined;
}
