/**
 * @file Performance regression guards.
 *
 * These assert CONSEQUENCES of the throttling rewrite, not its presence:
 *   - indexing and querying finish in a time that sleep-based throttling could
 *     not possibly achieve, so reintroducing it turns these red;
 *   - the memoized popCount stays correct across every mutation path, so the
 *     speedup cannot silently corrupt similarity scores.
 *
 * The bug being guarded: processDocument() previously slept 16ms per 10-word
 * chunk, making a single 1,000-word note take ~1.6s, and getSimilarDocuments()
 * slept 16ms per 10 comparisons.
 */

import { describe, it, expect } from 'vitest';
import { BloomFilter } from '../src/bloom';
import { MultiResolutionBloomFilterProvider } from '../src/multi-bloom';

function makeDoc(seed: number, words: number): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++) out.push(`term${(seed * 31 + i * 17) % 900}`);
  return out.join(' ');
}

function makeProvider(): MultiResolutionBloomFilterProvider {
  const vault = {
    getMarkdownFiles: () => [],
    cachedRead: () => Promise.resolve(''),
    adapter: {
      exists: () => Promise.resolve(false),
      read: () => Promise.resolve(''),
      write: () => Promise.resolve(),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    configDir: '/mock/config',
  } as never;

  return new MultiResolutionBloomFilterProvider(vault, {
    ngramSizes: [3],
    bloomSizes: [2048],
    hashFunctions: [3],
    similarityThreshold: 0.1,
    useWordBasedCandidates: true,
  });
}

describe('BloomFilter.popCount memoization', () => {
  it('matches a fresh count and tracks add()', () => {
    const f = new BloomFilter(1024, 3);
    expect(f.popCount()).toBe(0);

    f.add('alpha');
    const afterFirst = f.popCount();
    expect(afterFirst).toBeGreaterThan(0);

    // Memo must invalidate on further writes, not return the stale value.
    f.add('beta');
    expect(f.popCount()).toBeGreaterThanOrEqual(afterFirst);

    // Independent recount of the same bits.
    let manual = 0;
    const bits = f.getBitArray();
    for (let i = 0; i < bits.length; i++) {
      let v = bits[i];
      while (v) { manual += v & 1; v >>>= 1; }
    }
    expect(f.popCount()).toBe(manual);
  });

  it('invalidates on clear(), deserialize() and setBitArray()', () => {
    const f = new BloomFilter(1024, 3);
    for (const w of ['a', 'b', 'c', 'd']) f.add(w);
    expect(f.popCount()).toBeGreaterThan(0);

    f.clear();
    expect(f.popCount()).toBe(0);

    const src = new BloomFilter(1024, 3);
    for (const w of ['x', 'y', 'z']) src.add(w);
    const expected = src.popCount();

    f.deserialize({ size: 1024, hashFunctions: 3, bitArray: Array.from(src.getBitArray()) });
    expect(f.popCount()).toBe(expected);

    const g = new BloomFilter(1024, 3);
    g.popCount(); // prime the memo at 0 before overwriting the array
    g.setBitArray(new Uint32Array(src.getBitArray()));
    expect(g.popCount()).toBe(expected);
  });

  it('similarity is unchanged by memoization (repeat calls agree)', () => {
    const a = new BloomFilter(2048, 3);
    const b = new BloomFilter(2048, 3);
    for (let i = 0; i < 200; i++) { a.add(`w${i}`); b.add(`w${i * 2}`); }

    const first = a.similarity(b);
    expect(a.similarity(b)).toBe(first);

    // A mutation must move the score, proving the memo is not pinning it.
    for (let i = 0; i < 200; i++) b.add(`w${i}`);
    expect(a.similarity(b)).not.toBe(first);
  });
});

describe('throttling does not idle', () => {
  it('indexes a long document far faster than per-chunk sleeping allowed', async () => {
    const provider = makeProvider();
    const words = 2000; // 200 chunks of 10 -> 200 x 16ms = 3.2s under the old code

    const start = performance.now();
    await provider.processDocument('long.md', makeDoc(1, words));
    const elapsed = performance.now() - start;

    // Measured ~25ms. 200 chunk sleeps at 16ms would be ~3200ms.
    expect(elapsed).toBeLessThan(300);
  });

  it('indexes many documents without fixed per-document sleeps', async () => {
    const provider = makeProvider();
    const docs = 60;

    const start = performance.now();
    for (let i = 0; i < docs; i++) {
      await provider.processDocument(`doc${i}.md`, makeDoc(i, 120));
    }
    const elapsed = performance.now() - start;

    // Old code: >=53ms of fixed sleeps per document, i.e. >3s for 60 docs,
    // before counting the per-chunk sleeps.
    // Measured ~75ms for 60 docs.
    expect(elapsed).toBeLessThan(600);
  });

  it('queries without sleeping per batch of comparisons', async () => {
    const provider = makeProvider();
    const docs = 200;
    for (let i = 0; i < docs; i++) {
      await provider.processDocument(`doc${i}.md`, makeDoc(i, 60));
    }

    const start = performance.now();
    const results = await provider.getSimilarDocuments('doc0.md', 10);
    const elapsed = performance.now() - start;

    // Old code: 200/10 = 20 yields x 16ms = 320ms of pure sleep minimum.
    expect(elapsed).toBeLessThan(250);
    expect(Array.isArray(results)).toBe(true);
  });
});
