/**
 * @file Bloom filter similarity implementation for the Related Notes plugin.
 * A lightweight similarity algorithm based on bloom filters of character n-grams.
 */

'use strict';

import { tokenize } from './core';
import { isDebugMode, logIfDebugModeEnabled } from './logging';

/**
 * BloomFilter class that implements a lightweight bloom filter
 * Optimized for memory efficiency while maintaining reasonable accuracy
 */
export class BloomFilter {
  private bitArray: Uint32Array;
  private readonly size: number;
  private readonly hashFunctions: number;
  private readonly addedItems: Set<string> = new Set(); // Track added items for debugging
  private maxTrackedItems = 10000; // Limit tracked items to prevent memory leak

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

    logIfDebugModeEnabled(`Created bloom filter with ${this.size} bits and ${hashFunctions} hash functions`);
    logIfDebugModeEnabled(`Memory usage: ${this.size / 8} bytes (${this.size / 8 / 1024} KB)`);
  }

  /**
   * Gets the actual size of the bloom filter in bits
   */
  public getSize(): number {
    return this.size;
  }

  /**
   * Gets the number of hash functions
   */
  public getHashFunctions(): number {
    return this.hashFunctions;
  }

  /**
   * Gets the memory usage in bytes
   */
  public getMemoryUsage(): number {
    return this.size / 8;
  }

  /**
   * Gets the estimated false positive rate based on current usage
   */
  public getFalsePositiveRate(): number {
    const m = this.size; // Filter size in bits
    const k = this.hashFunctions; // Number of hash functions
    const n = this.addedItems.size; // Number of items added

    // False positive probability formula: (1 - e^(-k*n/m))^k
    const power = -k * n / m;
    const innerTerm = 1 - Math.exp(power);
    return Math.pow(innerTerm, k);
  }

  /**
   * Adds an item to the bloom filter
   * @param item The item to add
   */
  add(item: string): void {
    // Track for debugging but limit memory usage
    if (this.addedItems.size < this.maxTrackedItems) {
      this.addedItems.add(item);
    } else if (this.addedItems.size === this.maxTrackedItems && isDebugMode()) {
      logIfDebugModeEnabled(`BloomFilter: Stopped tracking items to prevent memory leak (max: ${this.maxTrackedItems})`);
    }

    const hashes = this.getHashes(item);
    if (isDebugMode() && item.length < 10) { // Only log short items to avoid spam
      logIfDebugModeEnabled(`Adding item: "${item}" with hashes:`, hashes.map(h => h % this.size));
    }

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
   * Sets the bit array directly (used for deserialization)
   * @param array The bit array to set
   */
  setBitArray(array: Uint32Array): void {
    if (array.length === this.bitArray.length) {
      this.bitArray = array;
    } else {
      throw new Error(`Array length mismatch: got ${array.length}, expected ${this.bitArray.length}`);
    }
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
   * Serialize the bloom filter to a JSON-compatible object
   * @returns Serialized bloom filter data
   */
  serialize(): { size: number; hashFunctions: number; bitArray: number[] } {
    return {
      size: this.size,
      hashFunctions: this.hashFunctions,
      bitArray: Array.from(this.bitArray)
    };
  }

  /**
   * Deserialize and restore bloom filter from serialized data
   * @param data Serialized bloom filter data
   */
  deserialize(data: { size: number; hashFunctions: number; bitArray: number[] }): void {
    if (data.size !== this.size || data.hashFunctions !== this.hashFunctions) {
      throw new Error(`Cannot deserialize: size/hash mismatch. Expected ${this.size}/${this.hashFunctions}, got ${data.size}/${data.hashFunctions}`);
    }
    this.bitArray = new Uint32Array(data.bitArray);
    this.addedItems.clear(); // Clear tracked items since we don't serialize them
  }

  /**
   * Clear the bloom filter and reset all tracking data
   */
  clear(): void {
    this.bitArray.fill(0);
    this.addedItems.clear();
  }

  /**
   * Calculate Jaccard similarity between two bloom filters
   * @param other The other bloom filter to compare with
   * @returns Similarity score between 0 and 1
   */
  similarity(other: BloomFilter): number {
    // Check if filters have the same size
    if (this.size !== other.size) {
      logIfDebugModeEnabled(`Cannot directly compare bloom filters of different sizes: ${this.size} vs ${other.size}`);
      return 0;
    }

    let intersectionBits = 0;
    let unionBits = 0;
    let thisBits = 0;
    let otherBits = 0;

    for (let i = 0; i < this.bitArray.length; i++) {
      const intersection = this.bitArray[i] & other.bitArray[i];
      const union = this.bitArray[i] | other.bitArray[i];

      // Count bits in each array
      const thisCount = countBits(this.bitArray[i]);
      const otherCount = countBits(other.bitArray[i]);

      // Count bits in intersection and union
      intersectionBits += countBits(intersection);
      unionBits += countBits(union);

      thisBits += thisCount;
      otherBits += otherCount;
    }

    // Check for nearly empty documents
    const minBitsRequired = 5; // Minimum number of bits set to consider meaningful
    if (thisBits < minBitsRequired || otherBits < minBitsRequired) {
      // If either document has too few bits set, it's likely too short to compare meaningfully
      logIfDebugModeEnabled(`One or both documents too small for meaningful comparison: ${thisBits} vs ${otherBits} bits set`);
      return 0;
    }

    // Calculate raw Jaccard similarity
    let similarity = unionBits === 0 ? 0 : intersectionBits / unionBits;

    // Check for filter saturation (too many bits set)
    const thisRatio = thisBits / this.size;
    const otherRatio = otherBits / this.size;

    // If either filter is highly saturated (>40% bits set), scale down similarity
    // This reduces false positives when bloom filters become saturated
    if (thisRatio > 0.4 || otherRatio > 0.4) {
      // Scale down more aggressively as saturation increases
      const saturationFactor = Math.max(thisRatio, otherRatio);
      // Apply polynomial scaling (stronger than logarithmic)
      similarity = similarity * Math.pow(1 - saturationFactor, 2);
    }

    const rawSimilarity = unionBits === 0 ? 0 : intersectionBits / unionBits;
    logIfDebugModeEnabled(
      `Similarity details:
      - Filter 1: ${thisBits} bits set (${(thisRatio * 100).toFixed(1)}% of capacity)
      - Filter 2: ${otherBits} bits set (${(otherRatio * 100).toFixed(1)}% of capacity)
      - Intersection: ${intersectionBits} bits
      - Union: ${unionBits} bits
      - Items in filter 1: ${this.addedItems.size}
      - Items in filter 2: ${other.addedItems.size}
      - Raw similarity: ${(rawSimilarity * 100).toFixed(2)}%`
    );

    return similarity;
  }

  /**
   * Fast intersection count for candidate selection
   * @param other The other bloom filter to compare with
   * @returns Number of intersecting bits (higher = more similar)
   */
  intersectionCount(other: BloomFilter): number {
    // Check if filters have the same size
    if (this.size !== other.size) {
      return 0;
    }

    let intersectionBits = 0;

    // Count intersecting bits efficiently
    for (let i = 0; i < this.bitArray.length; i++) {
      intersectionBits += countBits(this.bitArray[i] & other.bitArray[i]);
    }

    return intersectionBits;
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
  private readonly documentNgrams = new Map<string, Set<string>>(); // Track n-grams for debugging

  constructor(
    ngramSize: number = 3,
    bloomFilterSize: number = 256,
    hashFunctions: number = 3,
    config: any = {}
  ) {
    this.ngramSize = ngramSize;
    this.bloomFilterSize = bloomFilterSize;
    this.hashFunctions = hashFunctions;

    // Configure adaptive stopwords parameters from config if provided
    if (config.commonWordsThreshold) {
      this.commonWordsThreshold = config.commonWordsThreshold;
    }
    if (config.maxStopwords) {
      this.maxStopwords = config.maxStopwords;
    }
    if (config.minWordLength) {
      this.minWordLength = config.minWordLength;
    }

    logIfDebugModeEnabled(`Created BloomFilterSimilarityProvider with:
      - n-gram size: ${ngramSize}
      - bloom filter size: ${bloomFilterSize} bits
      - hash functions: ${hashFunctions}
      - memory per document: ${bloomFilterSize / 8} bytes
      - adaptive stopwords: true (max: ${this.maxStopwords}, threshold: ${this.commonWordsThreshold * 100}%)`);

    // Note: This implementation adaptively identifies and filters out common words
    // by analyzing their frequency across documents. This works across any language 
    // and adapts to the specific content of the vault.
  }

  /**
   * Get statistics about the bloom filter similarity provider
   */
  public getStats(): any {
    const totalNgrams = Array.from(this.documentNgrams.values())
      .reduce((sum, ngrams) => sum + ngrams.size, 0);

    const avgNgramsPerDoc = this.documentNgrams.size > 0
      ? totalNgrams / this.documentNgrams.size
      : 0;

    const memoryUsage = this.bloomFilters.size * this.bloomFilterSize / 8;

    return {
      documentsIndexed: this.bloomFilters.size,
      ngramSize: this.ngramSize,
      bloomFilterSize: this.bloomFilterSize,
      hashFunctions: this.hashFunctions,
      adaptiveStopwords: true,
      stopwordsComputed: this.commonWordsComputed,
      stopwordsCount: this.commonWords.size,
      stopwordsThreshold: this.commonWordsThreshold,
      maxStopwords: this.maxStopwords,
      documentsAnalyzed: this.totalDocuments,
      totalNgrams,
      avgNgramsPerDoc,
      memoryUsageBytes: memoryUsage,
      memoryUsageKB: memoryUsage / 1024,
      memoryUsageMB: memoryUsage / (1024 * 1024)
    };
  }

  /**
   * Process a document and create a bloom filter of its n-grams
   * First phase: track word frequencies
   * Second phase: compute and apply bloom filters
   * @param docId Document identifier
   * @param text Document text
   */
  processDocument(docId: string, text: string): void {
    const startTime = performance.now();

    // Track word frequencies for adaptive stopwords detection
    this.trackWordFrequencies(docId, text);

    // If we've processed enough documents and haven't computed common words yet,
    // compute them now
    if (this.totalDocuments >= 100 && !this.commonWordsComputed) {
      this.computeCommonWords();
    }

    // Create a bloom filter with the specified size and hash functions
    const filter = new BloomFilter(this.bloomFilterSize, this.hashFunctions);
    const ngrams = this.extractNgrams(text);

    // Store n-grams for debugging
    this.documentNgrams.set(docId, ngrams);

    // Add each n-gram to the bloom filter
    for (const ngram of ngrams) {
      filter.add(ngram);
    }

    // Store the bloom filter
    this.bloomFilters.set(docId, filter);

    // Log processing time and stats
    const endTime = performance.now();

    logIfDebugModeEnabled(`Processed document ${docId}:
      - Length: ${text.length} characters
      - Extracted ${ngrams.size} unique n-grams
      - Filter size: ${this.bloomFilterSize} bits (${this.bloomFilterSize / 8} bytes)
      - Filter saturation: ${filter.getFalsePositiveRate().toFixed(4)}
      - Processing time: ${(endTime - startTime).toFixed(2)}ms
      - Common words: ${this.commonWordsComputed ? this.commonWords.size : 'not yet computed'}`);
  }

  // Adaptive stopwords tracking
  private readonly wordFrequencies = new Map<string, number>();
  private readonly wordDocumentCount = new Map<string, Set<string>>();
  private readonly commonWords = new Set<string>();
  private totalDocuments = 0;
  private commonWordsThreshold = 0.5; // Words occurring in >50% of documents are considered common
  private commonWordsComputed = false;
  private minWordLength = 2; // Minimum word length to consider
  private maxStopwords = 200; // Maximum number of stopwords to identify

  /**
   * Track word frequencies and document occurrences to identify common words
   * @param docId Document identifier
   * @param text Document text
   */
  private trackWordFrequencies(docId: string, text: string): void {
    if (this.commonWordsComputed) return; // Skip if we've already computed common words

    // Use the tokenize function from core
    const processed = tokenize(text);

    // Get unique words from the document
    const words = processed.toLowerCase().split(/\s+/);
    const uniqueWords = new Set<string>();

    // Count word frequencies
    for (const word of words) {
      if (word.length <= this.minWordLength) continue; // Skip very short words

      // Update overall word frequency
      this.wordFrequencies.set(word, (this.wordFrequencies.get(word) || 0) + 1);

      // Track unique words in this document
      uniqueWords.add(word);
    }

    // Track which documents each word appears in
    for (const word of uniqueWords) {
      if (!this.wordDocumentCount.has(word)) {
        this.wordDocumentCount.set(word, new Set());
      }
      this.wordDocumentCount.get(word)?.add(docId);
    }

    // Increment total documents count
    this.totalDocuments++;
  }

  /**
   * Compute common words based on frequency and document occurrence
   */
  private computeCommonWords(): void {
    if (this.commonWordsComputed) return;
    if (this.totalDocuments < 10) return; // Need at least 10 documents for meaningful statistics

    const wordScores = new Map<string, number>();

    // Calculate a score for each word based on frequency and document coverage
    for (const [word, frequency] of this.wordFrequencies.entries()) {
      const docsWithWord = this.wordDocumentCount.get(word)?.size || 0;
      const documentCoverage = docsWithWord / this.totalDocuments;

      // Skip rare words
      if (docsWithWord < 5) continue;

      // Score words by their document coverage
      wordScores.set(word, documentCoverage);
    }

    // Sort words by score (highest first)
    const sortedWords = Array.from(wordScores.entries())
      .sort((a, b) => b[1] - a[1]);

    // Identify common words (those above threshold or up to maxStopwords)
    for (const [word, score] of sortedWords) {
      if (score >= this.commonWordsThreshold || this.commonWords.size < this.maxStopwords) {
        this.commonWords.add(word);
      } else {
        break;
      }
    }

    // Mark as computed
    this.commonWordsComputed = true;

    logIfDebugModeEnabled(`Computed ${this.commonWords.size} common words from ${this.totalDocuments} documents`);

    if (this.commonWords.size <= 50) {
      logIfDebugModeEnabled(`Common words: ${Array.from(this.commonWords).join(', ')}`);
    } else {
      logIfDebugModeEnabled(`Top 50 common words: ${Array.from(this.commonWords).slice(0, 50).join(', ')}...`);
    }

    // Free memory
    this.wordFrequencies.clear();
    this.wordDocumentCount.clear();
  }

  /**
   * Extract words from text to use as items in bloom filter
   * @param text Input text
   * @returns Set of words
   */
  private extractNgrams(text: string): Set<string> {
    const startTime = performance.now();

    // Use the existing tokenize function from core
    const processed = tokenize(text);

    // Split into words and convert to lowercase
    const words = processed.toLowerCase().split(/\s+/);

    // Filter out common and short words
    let meaningfulWords: string[];
    let excludedCount = 0;

    if (this.commonWordsComputed) {
      // Use adaptive stopwords
      meaningfulWords = words.filter(word =>
        word.length > this.minWordLength && !this.commonWords.has(word)
      );
      excludedCount = words.length - meaningfulWords.length;
    } else {
      // Just filter by length until we have enough data
      meaningfulWords = words.filter(word => word.length > this.minWordLength);
      excludedCount = words.length - meaningfulWords.length;
    }

    // Create a set of words (automatically deduplicates)
    const wordSet = new Set<string>(meaningfulWords);

    // Also add word pairs (bigrams) for better context capture
    // Limit the total number of bigrams to avoid creating too many
    const maxBigrams = 300;
    let bigramCount = 0;

    for (let i = 0; i < meaningfulWords.length - 1 && bigramCount < maxBigrams; i++) {
      const bigram = `${meaningfulWords[i]} ${meaningfulWords[i + 1]}`;
      wordSet.add(bigram);
      bigramCount++;
    }

    const endTime = performance.now();

    const excludedPercent = words.length > 0 ? (excludedCount / words.length * 100).toFixed(1) : '0';
    const method = this.commonWordsComputed ? 'adaptive stopwords' : 'length filter';
    logIfDebugModeEnabled(`Filtered out ${excludedCount} words (${excludedPercent}% of total) using ${method}`);

    // Only log if we have few enough words to display
    const sampleSize = Math.min(10, wordSet.size);
    if (wordSet.size < 100) {
      const sample = Array.from(wordSet).slice(0, sampleSize);
      logIfDebugModeEnabled(`Extracted ${wordSet.size} words/phrases in ${(endTime - startTime).toFixed(2)}ms. Sample: ${sample.join(', ')}`);
    } else {
      logIfDebugModeEnabled(`Extracted ${wordSet.size} words/phrases in ${(endTime - startTime).toFixed(2)}ms`);
    }

    return wordSet;
  }

  /**
   * Calculate similarity between two documents
   * @param docId1 First document ID
   * @param docId2 Second document ID
   * @returns Similarity score between 0 and 1
   */
  calculateSimilarity(docId1: string, docId2: string): number {
    const startTime = performance.now();

    // Get the bloom filters for both documents
    const filter1 = this.bloomFilters.get(docId1);
    const filter2 = this.bloomFilters.get(docId2);

    // If either filter is missing, return 0
    if (!filter1 || !filter2) {
      if (!filter1) logIfDebugModeEnabled(`Document ${docId1} not found`);
      if (!filter2) logIfDebugModeEnabled(`Document ${docId2} not found`);
      return 0;
    }

    // Calculate the actual Jaccard similarity
    const similarity = filter1.similarity(filter2);

    const endTime = performance.now();

    // Calculate the actual n-gram overlap for comparison with the bloom filter estimation
    const ngrams1 = this.documentNgrams.get(docId1);
    const ngrams2 = this.documentNgrams.get(docId2);

    if (ngrams1 && ngrams2) {
      // Calculate actual Jaccard similarity of n-grams
      const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
      const union = new Set([...ngrams1, ...ngrams2]);
      const actualSimilarity = intersection.size / union.size;

      logIfDebugModeEnabled(`Similarity calculation for ${docId1} and ${docId2}:
        - Bloom filter similarity: ${(similarity * 100).toFixed(2)}%
        - Actual n-gram Jaccard similarity: ${(actualSimilarity * 100).toFixed(2)}%
        - Estimation error: ${Math.abs(similarity - actualSimilarity).toFixed(4)}
        - Common n-grams: ${intersection.size} of ${ngrams1.size}/${ngrams2.size}
        - Calculation time: ${(endTime - startTime).toFixed(2)}ms`);
    } else {
      logIfDebugModeEnabled(`Similarity calculation for ${docId1} and ${docId2}: ${(similarity * 100).toFixed(2)}%`);
    }

    return similarity;
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
    const startTime = performance.now();

    // Get the bloom filter for the query document
    const queryFilter = this.bloomFilters.get(queryDocId);
    if (!queryFilter) {
      logIfDebugModeEnabled(`Query document ${queryDocId} not found`);
      return [];
    }

    const results: [string, number][] = [];
    let comparisons = 0;

    // Compare with all other documents
    for (const [docId, filter] of this.bloomFilters.entries()) {
      if (docId === queryDocId) continue; // Skip self-comparison

      comparisons++;
      const similarity = queryFilter.similarity(filter);

      if (similarity >= threshold) {
        results.push([docId, similarity]);
      }
    }

    // Sort by similarity and limit results
    const sortedResults = results
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    const endTime = performance.now();

    logIfDebugModeEnabled(`Found ${sortedResults.length} similar documents to ${queryDocId}:
      - Compared with ${comparisons} documents
      - Threshold: ${threshold}
      - Time: ${(endTime - startTime).toFixed(2)}ms
      - Top matches: ${sortedResults.map(([id, sim]) =>
      `${id} (${(sim * 100).toFixed(1)}%)`).join(', ')}`);

    return sortedResults;
  }

  /**
   * Clear all bloom filters
   */
  clear(): void {
    this.bloomFilters.clear();
    this.documentNgrams.clear();
    this.wordFrequencies.clear();
    this.wordDocumentCount.clear();
    this.commonWords.clear();
  }

  /**
   * Get the number of documents indexed
   */
  size(): number {
    return this.bloomFilters.size;
  }
}