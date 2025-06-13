/**
 * @file Bloom filter similarity implementation for the Related Notes plugin.
 * A lightweight similarity algorithm based on bloom filters of character n-grams.
 */

'use strict';

import { tokenize } from './core';

/**
 * BloomFilter class that implements a lightweight bloom filter
 * Optimized for memory efficiency while maintaining reasonable accuracy
 */
export class BloomFilter {
  private readonly bitArray: Uint32Array;
  private readonly size: number;
  private readonly hashFunctions: number;

  /**
   * Creates a new bloom filter
   * @param size Size of the bloom filter in bits (default: 256 bits)
   * @param hashFunctions Number of hash functions to use (default: 3)
   */
  constructor(size: number = 256, hashFunctions: number = 3) {
    // Convert size to bytes and ensure it's a multiple of 32 (for Uint32Array)
    this.size = Math.ceil(size / 32) * 32;
    this.bitArray = new Uint32Array(this.size / 32);
    this.hashFunctions = hashFunctions;
  }

  /**
   * Adds an item to the bloom filter
   * @param item The item to add
   */
  add(item: string): void {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const bitIndex = hash % this.size;
      const arrayIndex = Math.floor(bitIndex / 32);
      const bitOffset = bitIndex % 32;
      this.bitArray[arrayIndex] |= 1 << bitOffset;
    }
  }

  /**
   * Checks if an item might be in the bloom filter
   * @param item The item to check
   * @returns True if the item might be in the filter, false if it definitely isn't
   */
  contains(item: string): boolean {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const bitIndex = hash % this.size;
      const arrayIndex = Math.floor(bitIndex / 32);
      const bitOffset = bitIndex % 32;
      if (!(this.bitArray[arrayIndex] & (1 << bitOffset))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Gets the raw bit array for similarity comparison
   */
  getBitArray(): Uint32Array {
    return this.bitArray;
  }

  /**
   * Generates hash values for an item
   * @param item The item to hash
   * @returns Array of hash values
   */
  private getHashes(item: string): number[] {
    const hashes: number[] = [];

    // FNV-1a hash
    const fnv1a = (str: string): number => {
      let hash = 2166136261; // FNV offset basis
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return hash >>> 0; // Convert to unsigned 32-bit integer
    };

    // djb2 hash
    const djb2 = (str: string): number => {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
      }
      return hash >>> 0; // Convert to unsigned 32-bit integer
    };

    // sdbm hash
    const sdbm = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + (hash << 6) + (hash << 16) - hash;
      }
      return hash >>> 0; // Convert to unsigned 32-bit integer
    };

    // Base hash using FNV-1a
    const baseHash = fnv1a(item);
    hashes.push(baseHash);

    // Generate additional hashes if needed
    if (this.hashFunctions > 1) hashes.push(djb2(item));
    if (this.hashFunctions > 2) hashes.push(sdbm(item));

    // For any additional hash functions, use linear combinations of the base hashes
    for (let i = 3; i < this.hashFunctions; i++) {
      hashes.push((hashes[0] + i * hashes[1]) >>> 0);
    }

    return hashes;
  }

  /**
   * Calculate Jaccard similarity between two bloom filters
   * @param other The other bloom filter to compare with
   * @returns Similarity score between 0 and 1
   */
  similarity(other: BloomFilter): number {
    if (this.size !== other.size) {
      throw new Error('Bloom filters must be the same size for comparison');
    }

    let intersectionBits = 0;
    let unionBits = 0;

    for (let i = 0; i < this.bitArray.length; i++) {
      const intersection = this.bitArray[i] & other.bitArray[i];
      const union = this.bitArray[i] | other.bitArray[i];
      
      // Count bits in intersection and union
      intersectionBits += countBits(intersection);
      unionBits += countBits(union);
    }

    return unionBits === 0 ? 0 : intersectionBits / unionBits;
  }
}

/**
 * Count the number of bits set to 1 in a 32-bit integer
 */
function countBits(n: number): number {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

/**
 * A similarity provider based on bloom filters of character n-grams
 */
export class BloomFilterSimilarityProvider {
  private readonly bloomFilters = new Map<string, BloomFilter>();
  private readonly ngramSize: number;
  private readonly bloomFilterSize: number;
  private readonly hashFunctions: number;

  constructor(
    ngramSize: number = 3,
    bloomFilterSize: number = 256,
    hashFunctions: number = 3
  ) {
    this.ngramSize = ngramSize;
    this.bloomFilterSize = bloomFilterSize;
    this.hashFunctions = hashFunctions;
  }

  /**
   * Process a document and create a bloom filter of its n-grams
   * @param docId Document identifier
   * @param text Document text
   */
  processDocument(docId: string, text: string): void {
    const filter = new BloomFilter(this.bloomFilterSize, this.hashFunctions);
    const ngrams = this.extractNgrams(text);
    
    for (const ngram of ngrams) {
      filter.add(ngram);
    }
    
    this.bloomFilters.set(docId, filter);
  }

  /**
   * Extract character n-grams from text
   * @param text Input text
   * @returns Set of n-grams
   */
  private extractNgrams(text: string): Set<string> {
    // Use the existing tokenize function from core
    const processed = tokenize(text);
    
    // Extract character n-grams
    const ngrams = new Set<string>();
    const chars = processed.replace(/\s+/g, ' ').toLowerCase();
    
    for (let i = 0; i <= chars.length - this.ngramSize; i++) {
      ngrams.add(chars.substring(i, i + this.ngramSize));
    }
    
    return ngrams;
  }

  /**
   * Calculate similarity between two documents
   * @param docId1 First document ID
   * @param docId2 Second document ID
   * @returns Similarity score between 0 and 1
   */
  calculateSimilarity(docId1: string, docId2: string): number {
    const filter1 = this.bloomFilters.get(docId1);
    const filter2 = this.bloomFilters.get(docId2);
    
    if (!filter1 || !filter2) {
      return 0;
    }
    
    return filter1.similarity(filter2);
  }

  /**
   * Get most similar documents to a query document
   * @param queryDocId Query document ID
   * @param limit Maximum number of results
   * @param threshold Minimum similarity threshold
   * @returns Array of [docId, similarity] pairs, sorted by similarity
   */
  getSimilarDocuments(
    queryDocId: string,
    limit: number = 10,
    threshold: number = 0.1
  ): [string, number][] {
    const queryFilter = this.bloomFilters.get(queryDocId);
    if (!queryFilter) return [];
    
    const results: [string, number][] = [];
    
    for (const [docId, filter] of this.bloomFilters.entries()) {
      if (docId === queryDocId) continue;
      
      const similarity = queryFilter.similarity(filter);
      if (similarity >= threshold) {
        results.push([docId, similarity]);
      }
    }
    
    return results
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
  }

  /**
   * Clear all bloom filters
   */
  clear(): void {
    this.bloomFilters.clear();
  }

  /**
   * Get the number of documents indexed
   */
  size(): number {
    return this.bloomFilters.size;
  }
}