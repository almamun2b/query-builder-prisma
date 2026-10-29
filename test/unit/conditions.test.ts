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
  it('refuses dangerous keys instead of writing them (audit F16)', () => {
    const input = { a: 1, ['__proto__']: { evil: true }, constructor: 2, prototype: 3 };
    const result = stripUndefined(input);
    expect(result).toEqual({ a: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('deepStripUndefined (audit F15)', () => {
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
  it('refuses dangerous keys at any depth (audit F16)', () => {
    const result = deepStripUndefined({ safe: 1, ['__proto__']: { evil: true } });
    expect(result).toEqual({ safe: 1 });
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe('expandDotPath', () => {
  it('expands a nested path', () => {
    expect(expandDotPath('avatar.size', { gte: 10 })).toEqual({ avatar: { size: { gte: 10 } } });
  });
  it('expands deep paths', () => {
    expect(expandDotPath('a.b.c', { v: 1 })).toEqual({ a: { b: { c: { v: 1 } } } });
  });
  it('accepts any leaf value (audit F6)', () => {
    expect(expandDotPath('avatar.size', 'desc')).toEqual({ avatar: { size: 'desc' } });
  });
  it('skips empty segments', () => {
    expect(expandDotPath('a..b', 1)).toEqual({ a: { b: 1 } });
  });
  it('refuses dangerous path segments (audit F16)', () => {
    expect(expandDotPath('a.__proto__.b', 1)).toEqual({});
    expect(expandDotPath('__proto__', 1)).toEqual({});
    expect(expandDotPath('a.constructor', 1)).toEqual({});
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
