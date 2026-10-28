import { describe, expect, it } from 'vitest';
import { combineAnd, expandDotPath, stripUndefined } from '../../src/core/conditions';

describe('stripUndefined', () => {
  it('removes undefined values', () => {
    expect(stripUndefined({ a: 1, b: undefined, c: 'x' })).toEqual({ a: 1, c: 'x' });
  });
});

describe('expandDotPath', () => {
  it('expands a nested path', () => {
    expect(expandDotPath('avatar.size', { gte: 10 })).toEqual({ avatar: { size: { gte: 10 } } });
  });
  it('expands deep paths', () => {
    expect(expandDotPath('a.b.c', { v: 1 })).toEqual({ a: { b: { c: { v: 1 } } } });
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
