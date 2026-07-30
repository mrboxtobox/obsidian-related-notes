/**
 * @file Guards that batching is a yield interval, not a scoring input.
 *
 * The bug: processDocument() sliced text into 10-word chunks and called
 * addText() on each. extractWords() derives bigrams within whatever text it is
 * given and caps them per call, so the chunk size silently became part of what
 * landed in the filter:
 *
 *   - bigrams never spanned a chunk boundary, losing one in ten;
 *   - the bigram cap could never bind (9 bigrams per chunk against a cap of
 *     100-200), so a long note produced several times the intended number;
 *   - extractWords()' low-fidelity switch (wordSet.size > 500) could never fire,
 *     because it only ever saw ~19 tokens, leaving MAX_BIGRAMS_*_LARGE dead.
 *
 * Tokenization is now done once per document, then hashed in batches. The
 * invariant below is what makes the batch size safe to tune.
 */

import { describe, it, expect } from 'vitest';
import { SingleBloomFilter, MultiResolutionBloomFilterProvider } from '../src/multi-bloom';
import { BLOOM_FILTER, CACHE } from '../src/constants';

function makeProvider(size = SIZE): MultiResolutionBloomFilterProvider {
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
    configDir: '/mock/config/dir',
  } as never;
  return new MultiResolutionBloomFilterProvider(vault, {
    ngramSizes: [3], bloomSizes: [size], hashFunctions: [3], similarityThreshold: 0.1,
  });
}

const SIZE = 8192;

const distinctWords = (n: number) => Array.from({ length: n }, (_, i) => `term${i}`);

/** Index a document by tokenizing once, then inserting in batches of `batch`. */
function indexInBatches(text: string, batch: number): SingleBloomFilter {
  const f = new SingleBloomFilter([3], [SIZE], [3]);
  const tokens = f.prepareTokens(text);
  for (let i = 0; i < tokens.length; i += batch) {
    f.addPreparedTokens(tokens, i, Math.min(i + batch, tokens.length));
  }
  return f;
}

/** The old behaviour: slice the TEXT, then tokenize each slice independently. */
function indexByTextChunks(words: string[], chunk: number): SingleBloomFilter {
  const f = new SingleBloomFilter([3], [SIZE], [3]);
  for (let i = 0; i < words.length; i += chunk) {
    f.addText(words.slice(i, i + chunk).join(' '));
  }
  return f;
}

const bitsOf = (f: SingleBloomFilter) => Array.from(f.getBitArray());
const bigramsIn = (tokens: string[]) => tokens.filter((t) => t.includes(' '));

describe('batch size does not affect filter contents', () => {
  const text = distinctWords(900).join(' ');

  it('every batch size produces an identical filter', () => {
    const reference = bitsOf(indexInBatches(text, 1));
    for (const batch of [7, 64, 512, 100_000]) {
      expect(bitsOf(indexInBatches(text, batch))).toEqual(reference);
    }
  });

  it('batched insertion matches a single addText of the whole document', () => {
    const whole = new SingleBloomFilter([3], [SIZE], [3]);
    whole.addText(text);
    expect(bitsOf(indexInBatches(text, 512))).toEqual(bitsOf(whole));
  });

  it('the old text-chunking really did differ, so this is not a vacuous test', () => {
    const words = distinctWords(900);
    expect(bitsOf(indexByTextChunks(words, 10))).not.toEqual(bitsOf(indexInBatches(words.join(' '), 512)));
  });
});

describe('bigrams span the whole document', () => {
  const words = distinctWords(40);
  const text = words.join(' ');

  it('includes bigrams that cross the old 10-word chunk boundary', () => {
    const tokens = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(text);
    // term9 -> term10 straddled the first old chunk boundary.
    expect(tokens).toContain('term9 term10');
    expect(tokens).toContain('term19 term20');
  });

  it('produces one bigram per adjacent pair, not per-chunk fragments', () => {
    const tokens = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(text);
    // 40 words -> 39 adjacent pairs, all under the cap.
    expect(bigramsIn(tokens)).toHaveLength(words.length - 1);
  });
});

describe('the bigram cap and fidelity switch are now reachable', () => {
  it('caps bigrams on a long document instead of scaling with length', () => {
    const short = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(distinctWords(300).join(' '));
    const long = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(distinctWords(3000).join(' '));

    // Ten times the words must not mean ten times the bigrams.
    expect(bigramsIn(long).length).toBeLessThan(bigramsIn(short).length * 10);
    expect(bigramsIn(long).length).toBeLessThanOrEqual(BLOOM_FILTER.MAX_BIGRAMS_NON_CJK);
  });

  it('switches to the low-fidelity cap past 500 distinct words', () => {
    // Under the threshold: the standard cap applies.
    const under = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(distinctWords(400).join(' '));
    expect(bigramsIn(under)).toHaveLength(BLOOM_FILTER.MAX_BIGRAMS_NON_CJK);

    // Over it: MAX_BIGRAMS_NON_CJK_LARGE, previously unreachable code.
    const over = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(distinctWords(600).join(' '));
    expect(bigramsIn(over)).toHaveLength(BLOOM_FILTER.MAX_BIGRAMS_NON_CJK_LARGE);
    expect(BLOOM_FILTER.MAX_BIGRAMS_NON_CJK_LARGE).toBeLessThan(BLOOM_FILTER.MAX_BIGRAMS_NON_CJK);
  });
});

describe('processDocument actually uses whole-document tokenization', () => {
  // Without this, every test above can pass while processDocument still slices
  // text into chunks — the helper is correct but never called. Verified by
  // reverting processDocument to per-chunk addText: these go red, the API-level
  // tests above do not.
  const DEFAULT_SIZE = BLOOM_FILTER.DEFAULT_FILTER_SIZE;

  function filterFor(provider: MultiResolutionBloomFilterProvider, id: string): SingleBloomFilter {
    const filters = (provider as unknown as { bloomFilters: Map<string, SingleBloomFilter> }).bloomFilters;
    const f = filters.get(id);
    if (!f) throw new Error(`no filter indexed for ${id}`);
    return f;
  }

  it('produces the same filter as a single whole-document addText', async () => {
    const text = distinctWords(300).join(' ');
    const provider = makeProvider(DEFAULT_SIZE);
    await provider.processDocument('doc.md', text);

    // Same preprocessing the indexer applied, so only tokenization differs.
    const processed = (provider as unknown as { preprocessText(t: string): string }).preprocessText(text);
    const reference = new SingleBloomFilter([3], [DEFAULT_SIZE], [3]);
    reference.addText(processed);

    expect(bitsOf(filterFor(provider, 'doc.md'))).toEqual(bitsOf(reference));
  });

  it('indexes bigrams that straddle the old chunk boundaries', async () => {
    const provider = makeProvider(DEFAULT_SIZE);
    await provider.processDocument('doc.md', distinctWords(60).join(' '));
    const filter = filterFor(provider, 'doc.md');

    // Boundary-spanning pairs under per-chunk tokenization were never formed.
    for (const bigram of ['term9 term10', 'term19 term20', 'term29 term30']) {
      expect(filter.filter.contains(bigram)).toBe(true);
    }
    // Control: a pair that is not adjacent should not be present, which also
    // shows the assertions above are not just bloom-filter false positives.
    expect(filter.filter.contains('term3 term40')).toBe(false);
  });
});

describe('the cache version forces stale filters to be rebuilt', () => {
  // Changing tokenization changes what a filter holds, so a cache written by an
  // older build must not be compared against freshly built filters. This is the
  // half of the bump that actually protects users.
  it('has been bumped past the pre-chunking-fix version', () => {
    expect(CACHE.VERSION).toBeGreaterThan(1);
  });

  it('the real validator rejects an older cache and accepts a current one', () => {
    const provider = makeProvider();
    // validateCacheStructure is private; reached deliberately because this is the
    // gate the bump relies on, and asserting version arithmetic instead would
    // prove nothing about whether stale caches are actually discarded.
    const validate = (cache: unknown) =>
      (provider as unknown as { validateCacheStructure(c: unknown): { isValid: boolean; reason?: string } })
        .validateCacheStructure(cache);

    const shape = {
      timestamp: Date.now(), // a zero timestamp is rejected separately, as too old
      filters: {},
      stats: {},
      params: { ngramSizes: [3], hashFunctions: [3], similarityThreshold: 0.1 },
    };

    const stale = validate({ ...shape, version: CACHE.VERSION - 1 });
    expect(stale.isValid).toBe(false);
    expect(stale.reason).toMatch(/version mismatch/i);

    expect(validate({ ...shape, version: CACHE.VERSION }).isValid).toBe(true);
  });
});

describe('CJK detection is a whole-document decision', () => {
  it('applies the CJK cap even when CJK text appears late in the document', () => {
    // Under the old scheme only the chunks containing CJK saw hasCJK = true.
    const asciiPrefix = distinctWords(600).join(' ');
    const tokens = new SingleBloomFilter([3], [SIZE], [3]).prepareTokens(`${asciiPrefix} 日本語 の 文章`);
    expect(bigramsIn(tokens)).toHaveLength(BLOOM_FILTER.MAX_BIGRAMS_CJK_LARGE);
  });
});
