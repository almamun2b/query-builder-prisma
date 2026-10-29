import { afterEach, describe, expect, it } from 'vitest';
import {
  configureQueryBuilder,
  registerDialect,
  resetDialectConfig,
  resolveDialect,
  setDialectDetector,
} from '../../src/dialects/registry';

afterEach(() => resetDialectConfig());

describe('resolveDialect', () => {
  it('falls back to universal capabilities', () => {
    const resolved = resolveDialect();
    expect(resolved.name).toBe('universal');
    expect(resolved.capabilities.caseInsensitiveMode).toBe(false);
  });
  it('explicit wins over global config', () => {
    configureQueryBuilder({ dialect: 'postgresql' });
    expect(resolveDialect('mongodb').name).toBe('mongodb');
    expect(resolveDialect().name).toBe('postgresql');
  });
  it('unknown names report universal for name AND capabilities (audit G8)', () => {
    const resolved = resolveDialect('not-a-db');
    expect(resolved.name).toBe('universal');
    expect(resolved.capabilities.caseInsensitiveMode).toBe(false);
  });
  it('detector is used when no explicit or global dialect is set', () => {
    setDialectDetector(() => 'mysql');
    expect(resolveDialect().name).toBe('mysql');
  });
  it('a registered detector returning undefined falls through to universal (audit G2)', () => {
    setDialectDetector(() => undefined);
    expect(resolveDialect().name).toBe('universal');
    expect(resolveDialect().capabilities.caseInsensitiveMode).toBe(false);
  });
  it('registerDialect supports future databases without core changes', () => {
    registerDialect('futuredb', { caseInsensitiveMode: true, caseInsensitiveCollation: false });
    expect(resolveDialect('futuredb').capabilities.caseInsensitiveMode).toBe(true);
  });
});

describe('dialect state sharing (audit F7)', () => {
  it('lives on globalThis under the shared symbol, so ESM+CJS copies converge', () => {
    const key = Symbol.for('query-builder-prisma.dialect-state');
    const host = globalThis as unknown as Record<symbol, { globalDialect?: string } | undefined>;
    configureQueryBuilder({ dialect: 'mysql' });
    expect(host[key]?.globalDialect).toBe('mysql');
    resetDialectConfig();
    expect(host[key]?.globalDialect).toBeUndefined();
  });
});
