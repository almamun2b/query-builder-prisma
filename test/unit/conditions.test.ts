import { describe, expect, it } from 'vitest';
import {
  combineAnd,
  deepStripUndefined,
  expandDotPath,
  stripUndefined,
} from '../../src/core/conditions';

describe('stripUndefined', () => {
  it('removes undefined values', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });
  it('throws on dangerous keys instead of writing or silently dropping them', () => {
    // JSON.parse yields a real own "__proto__" property, the shape of a hostile request body.
    const hostile = JSON.parse('{"a":1,"__proto__":{"evil":true}}') as Record<string, unknown>;
    expect(() => stripUndefined(hostile)).toThrow('Refused key "__proto__"');
    expect(() => stripUndefined({ a: 1, constructor: 2 })).toThrow('Refused key "constructor"');
    expect(() => stripUndefined({ a: 1, prototype: 3 })).toThrow('Refused key "prototype"');
    expect(({} as Record<string, unknown>).evil).toBeUndefined();
  });
});

describe('deepStripUndefined', () => {
  it('strips undefined at any depth without mutating the input', () => {
    const input = { a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [{ g: undefined, h: 3 }] };
    const result = deepStripUndefined(input);
    expect(result).toEqual({ a: 1, c: { e: 2 }, f: [{ h: 3 }] });
    expect(input.c).toEqual({ d: undefined, e: 2 });
    expect(input.f[0]).toEqual({ g: undefined, h: 3 });
  });
  it('preserves non-plain values like Dates and BigInts', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = deepStripUndefined({ at: date, n: BigInt(1), b: undefined });
    expect(result.at).toBe(date);
    expect(result.n).toBe(BigInt(1));
    expect(result.b).toBeUndefined();
  });
  it('throws on dangerous keys at any depth', () => {
    const hostile = JSON.parse('{"safe":1,"__proto__":{"evil":true}}') as Record<string, unknown>;
    expect(() => deepStripUndefined(hostile)).toThrow('Refused key "__proto__"');
    expect(() => deepStripUndefined({ ok: { nested: { constructor: 1 } } })).toThrow(
      'Refused key "constructor"',
    );
    expect(() => deepStripUndefined({ list: [{ prototype: 1 }] })).toThrow(
      'Refused key "prototype"',
    );
  });
});

describe('expandDotPath', () => {
  it('expands a nested path', () => {
    expect(expandDotPath('avatar.size', { gte: 10 })).toEqual({ avatar: { size: { gte: 10 } } });
  });
  it('expands deep paths', () => {
    expect(expandDotPath('a.b.c', { v: 1 })).toEqual({ a: { b: { c: { v: 1 } } } });
  });
  it('accepts any leaf value', () => {
    expect(expandDotPath('avatar.size', 'desc')).toEqual({ avatar: { size: 'desc' } });
  });
  it('skips empty segments', () => {
    expect(expandDotPath('a..b', 1)).toEqual({ a: { b: 1 } });
  });
  it('throws on dangerous path segments', () => {
    expect(() => expandDotPath('a.__proto__.b', 1)).toThrow('Refused key "__proto__"');
    expect(() => expandDotPath('__proto__', 1)).toThrow('Refused key "__proto__"');
    expect(() => expandDotPath('a.constructor', 1)).toThrow('Refused key "constructor"');
  });
  it('an empty path stays a harmless no-op', () => {
    expect(expandDotPath('', 1)).toEqual({});
    expect(expandDotPath('.', 1)).toEqual({});
  });
});

describe('combineAnd', () => {
  it('returns undefined with no conditions', () => {
    expect(combineAnd([])).toBeUndefined();
  });
  it('returns a single condition unwrapped', () => {
    expect(combineAnd([{ role: 'ADMIN' }])).toEqual({ role: 'ADMIN' });
  });
  it('ANDs multiple conditions', () => {
    expect(combineAnd([{ a: 1 }, { b: 2 }])).toEqual({ AND: [{ a: 1 }, { b: 2 }] });
  });
  it('prepends the seeded where first', () => {
    expect(combineAnd([{ b: 2 }], { seed: true })).toEqual({ AND: [{ seed: true }, { b: 2 }] });
  });
  it('ignores non-object custom where', () => {
    expect(combineAnd([{ a: 1 }], 'nonsense')).toEqual({ a: 1 });
  });
});
