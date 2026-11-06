import { describe, expect, it } from 'vitest';
import pkg from '../../package.json';

/**
 * The package is `"type": "module"`, so a `.d.ts` is typed as ESM. CJS consumers
 * (`require`) must get the `.d.cts` declaration tsup emits, or TypeScript
 * (node16/nodenext) treats the CJS entry as an ES module ("Masquerading as ESM").
 */
describe('package.json exports', () => {
  const root = pkg.exports['.'];

  it('ships separate type declarations for import and require', () => {
    expect(root.import.types).toBe('./dist/index.d.ts');
    expect(root.require.types).toBe('./dist/index.d.cts');
  });

  it('keeps the runtime entries matching the tsup output names', () => {
    expect(root.import.default).toBe('./dist/index.js');
    expect(root.require.default).toBe('./dist/index.cjs');
  });

  it('keeps the legacy top-level fields in sync', () => {
    expect(pkg.main).toBe(root.require.default);
    expect(pkg.module).toBe(root.import.default);
    expect(pkg.types).toBe(root.import.types);
  });
});
