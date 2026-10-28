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
  it('unknown names degrade to universal capabilities', () => {
    expect(resolveDialect('not-a-db').capabilities.caseInsensitiveMode).toBe(false);
  });
  it('detector is used when no explicit or global dialect is set', () => {
    setDialectDetector(() => 'mysql');
    expect(resolveDialect().name).toBe('mysql');
  });
  it('registerDialect supports future databases without core changes', () => {
    registerDialect('futuredb', { caseInsensitiveMode: true, caseInsensitiveCollation: false });
    expect(resolveDialect('futuredb').capabilities.caseInsensitiveMode).toBe(true);
  });
});
