/**
 * @file Correctness guards for the similarity score.
 *
 * The bug these exist for: similarity() used to multiply Jaccard by
 * (1 - saturation)^2 once a filter passed 40% occupancy. That is not a debiasing
 * correction, it is a penalty, and it destroyed true positives — a 3,200-word
 * note scored 0.0061 against an identical copy, so long notes were effectively
 * excluded from results, and identical long notes ranked BELOW barely-related
 * short ones.
 *
 * The invariant that catches it: a document is always perfectly similar to
 * itself, at every document length. Any length-dependent scoring fudge breaks
 * this immediately.
 */

import { describe, it, expect } from 'vitest';
import { BloomFilter } from '../src/bloom';
import { SingleBloomFilter } from '../src/multi-bloom';

const CHUNK = 10; // must match processDocument's chunking

function indexDoc(words: string[], size = 4096): SingleBloomFilter {
  const f = new SingleBloomFilter([3], [size], [3]);
  for (let i = 0; i < words.length; i += CHUNK) {
    f.addText(words.slice(i, i + CHUNK).join(' '));
  }
  return f;
}

const distinctWords = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

function saturation(f: SingleBloomFilter, size: number): number {
  const a = f.getBitArray();
  let c = 0;
  for (let i = 0; i < a.length; i++) { let v = a[i]; while (v) { c += v & 1; v >>>= 1; } }
  return c / size;
}

describe('self-similarity is length-independent', () => {
  // 800+ words push a 4096-bit filter past the old 40% penalty threshold.
  for (const n of [100, 400, 800, 1600, 3200]) {
    it(`a ${n}-word document is ~1.0 similar to an identical copy`, () => {
      const a = indexDoc(distinctWords(n));
      const b = indexDoc(distinctWords(n));
      expect(a.similarity(b)).toBeGreaterThan(0.95);
    });
  }

  it('holds even when the filter is heavily saturated', () => {
    const a = indexDoc(distinctWords(3200));
    expect(saturation(a, 4096)).toBeGreaterThan(0.5); // the regime that was broken
    expect(a.similarity(indexDoc(distinctWords(3200)))).toBeGreaterThan(0.95);
  });
});

describe('ranking is not inverted by document length', () => {
  it('identical long documents outrank merely-similar short ones', () => {
    const longA = indexDoc(distinctWords(1600));
    const longB = indexDoc(distinctWords(1600));
    const shortA = indexDoc(['alpha', 'beta', 'gamma', 'delta']);
    const shortB = indexDoc(['alpha', 'beta', 'gamma', 'epsilon']);

    // Previously 0.0491 vs 0.5556 — backwards.
    expect(longA.similarity(longB)).toBeGreaterThan(shortA.similarity(shortB));
  });
});

describe('discrimination still works', () => {
  const cooking = 'pasta tomato garlic olive oil basil simmer sauce recipe kitchen boil pan salt pepper onion'.split(' ');
  const baking = 'pizza tomato garlic olive oil basil oven dough recipe kitchen bake cheese salt pepper onion'.split(' ');
  const physics = 'quantum electron proton neutron wavefunction hamiltonian eigenvalue operator spin lattice photon boson'.split(' ');

  it('related documents score above unrelated ones', () => {
    const a = indexDoc(cooking);
    const related = a.similarity(indexDoc(baking));
    const unrelated = a.similarity(indexDoc(physics));

    expect(related).toBeGreaterThan(unrelated);
    expect(related).toBeGreaterThan(0.1);
  });

  it('disjoint documents do not score as similar', () => {
    expect(indexDoc(cooking).similarity(indexDoc(physics))).toBeLessThan(0.1);
  });
});

describe('score bounds and degenerate inputs', () => {
  it('never exceeds 1 or drops below 0', () => {
    for (const n of [20, 200, 900, 2500]) {
      const s = indexDoc(distinctWords(n)).similarity(indexDoc(distinctWords(n)));
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });

  it('returns 0 for a filter saturated to capacity', () => {
    // Every bit set: the cardinality estimator has no solution there, and every
    // document would otherwise look identical to every other.
    const a = new BloomFilter(256, 3);
    const b = new BloomFilter(256, 3);
    a.setBitArray(new Uint32Array(256 / 32).fill(0xffffffff));
    b.setBitArray(new Uint32Array(256 / 32).fill(0xffffffff));
    expect(a.similarity(b)).toBe(0);
  });

  it('returns 0 for documents too small to compare', () => {
    const tiny = new BloomFilter(1024, 3);
    const other = new BloomFilter(1024, 3);
    for (let i = 0; i < 50; i++) other.add(`w${i}`);
    expect(tiny.similarity(other)).toBe(0); // fewer than 5 bits set
  });

  it('returns 0 for mismatched filter sizes', () => {
    const a = new BloomFilter(1024, 3);
    const b = new BloomFilter(2048, 3);
    for (let i = 0; i < 50; i++) { a.add(`w${i}`); b.add(`w${i}`); }
    expect(a.similarity(b)).toBe(0);
  });
});
