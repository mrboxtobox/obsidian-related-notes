/**
 * @file Bloom filter similarity implementation for the Related Notes plugin.
 * A lightweight similarity algorithm based on bloom filters of character n-grams.
 */

'use strict';

import { tokenize } from './core';

// Logger for bloom filter operations
const DEBUG_MODE = true;

function log(...args: any[]) {
  if (DEBUG_MODE) {
    console.log('[BloomFilter]', ...args);
  }
}

/**
 * BloomFilter class that implements a lightweight bloom filter
 * Optimized for memory efficiency while maintaining reasonable accuracy
 */
export class BloomFilter {
  private readonly bitArray: Uint32Array;
  private readonly size: number;
  private readonly hashFunctions: number;
  private readonly addedItems: Set<string> = new Set(); // Track added items for debugging

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
    
    log(`Created bloom filter with ${this.size} bits and ${hashFunctions} hash functions`);
    log(`Memory usage: ${this.size / 8} bytes (${this.size / 8 / 1024} KB)`);
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
    this.addedItems.add(item); // Track for debugging
    
    const hashes = this.getHashes(item);
    if (DEBUG_MODE && item.length < 10) { // Only log short items to avoid spam
      log(`Adding item: "${item}" with hashes:`, hashes.map(h => h % this.size));
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

    const similarity = unionBits === 0 ? 0 : intersectionBits / unionBits;
    
    if (DEBUG_MODE) {
      log(
        `Similarity details:
        - Filter 1: ${thisBits} bits set (${thisBits / this.size * 100}% of capacity)
        - Filter 2: ${otherBits} bits set (${otherBits / this.size * 100}% of capacity)
        - Intersection: ${intersectionBits} bits
        - Union: ${unionBits} bits
        - Items in filter 1: ${this.addedItems.size}
        - Items in filter 2: ${other.addedItems.size}
        - Common items (estimated): ${Math.round(intersectionBits / (this.hashFunctions + other.hashFunctions) * 2)}
        - Jaccard similarity: ${(similarity * 100).toFixed(2)}%`
      );
      
      // Log a sample of items that were added to both filters
      const commonItems = [...this.addedItems].filter(item => other.addedItems.has(item));
      if (commonItems.length > 0) {
        log(`First 5 common items: ${commonItems.slice(0, 5).join(', ')}`);
      }
    }

    return similarity;
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
  private readonly config: any;

  constructor(
    ngramSize: number = 3,
    bloomFilterSize: number = 256,
    hashFunctions: number = 3,
    config: any = {}
  ) {
    this.ngramSize = ngramSize;
    this.bloomFilterSize = bloomFilterSize;
    this.hashFunctions = hashFunctions;
    this.config = config;
    
    log(`Created BloomFilterSimilarityProvider with:
      - n-gram size: ${ngramSize}
      - bloom filter size: ${bloomFilterSize} bits
      - hash functions: ${hashFunctions}
      - memory per document: ${bloomFilterSize / 8} bytes
      - stopwords list: ${this.commonWords.size} common words excluded`);
    
    // Note: This implementation filters out extremely common words (stopwords)
    // before generating n-grams. This focuses similarity matching on the most
    // meaningful terms, improving relevance by ignoring words like "the", "and", etc.
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
      stopwordsCount: this.commonWords.size,
      stopwordsEnabled: true,
      totalNgrams,
      avgNgramsPerDoc,
      memoryUsageBytes: memoryUsage,
      memoryUsageKB: memoryUsage / 1024,
      memoryUsageMB: memoryUsage / (1024 * 1024)
    };
  }

  /**
   * Process a document and create a bloom filter of its n-grams
   * @param docId Document identifier
   * @param text Document text
   */
  processDocument(docId: string, text: string): void {
    const startTime = performance.now();
    
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
    
    if (DEBUG_MODE) {
      log(`Processed document ${docId}:
        - Length: ${text.length} characters
        - Extracted ${ngrams.size} unique n-grams
        - Filter size: ${this.bloomFilterSize} bits (${this.bloomFilterSize / 8} bytes)
        - Filter saturation: ${filter.getFalsePositiveRate().toFixed(4)}
        - Processing time: ${(endTime - startTime).toFixed(2)}ms`);
    }
  }

  /**
   * List of extremely common words to exclude from n-gram generation
   * These words occur so frequently that they don't provide meaningful similarity information
   */
  private readonly commonWords = new Set([
    // Articles
    'the', 'a', 'an',
    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet', 'for',
    // Prepositions
    'in', 'on', 'at', 'by', 'to', 'of', 'with', 'from', 'about',
    // Common verbs
    'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'can', 'could', 'may', 'might', 'must', 'should',
    // Pronouns
    'i', 'me', 'my', 'mine', 'myself',
    'you', 'your', 'yours', 'yourself',
    'he', 'him', 'his', 'himself',
    'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself',
    'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'whose',
    // Common adverbs
    'not', 'very', 'too', 'also', 'even', 'just', 'only', 'then',
    // Numbers and quantities
    'one', 'two', 'three', 'first', 'second', 'third', 'many', 'some', 'any', 'all', 'most',
    // Time-related
    'now', 'when', 'while', 'after', 'before', 'during',
    // Other high-frequency words
    'what', 'why', 'how', 'where', 'there', 'here', 'than', 'like'
  ]);

  /**
   * Extract character n-grams from text
   * @param text Input text
   * @returns Set of n-grams
   */
  private extractNgrams(text: string): Set<string> {
    const startTime = performance.now();
    
    // Use the existing tokenize function from core
    const processed = tokenize(text);
    
    // Extract character n-grams from meaningful words only
    const ngrams = new Set<string>();
    
    // Split into words
    const words = processed.toLowerCase().split(/\s+/);
    
    // Filter out extremely common words
    const meaningfulWords = words.filter(word => 
      word.length > 1 && !this.commonWords.has(word)
    );
    
    if (DEBUG_MODE) {
      const excludedCount = words.length - meaningfulWords.length;
      const excludedPercent = (excludedCount / words.length * 100).toFixed(1);
      log(`Filtered out ${excludedCount} common words (${excludedPercent}% of total)`);
    }
    
    // Create n-grams from the filtered words
    const filteredText = meaningfulWords.join(' ');
    const chars = filteredText.replace(/\s+/g, ' ');
    
    for (let i = 0; i <= chars.length - this.ngramSize; i++) {
      ngrams.add(chars.substring(i, i + this.ngramSize));
    }
    
    const endTime = performance.now();
    
    if (DEBUG_MODE) {
      // Only log if we have few enough n-grams to display
      const sampleSize = Math.min(10, ngrams.size);
      if (ngrams.size < 100) {
        const sample = Array.from(ngrams).slice(0, sampleSize);
        log(`Extracted ${ngrams.size} n-grams in ${(endTime - startTime).toFixed(2)}ms. Sample: ${sample.join(', ')}`);
      } else {
        log(`Extracted ${ngrams.size} n-grams in ${(endTime - startTime).toFixed(2)}ms`);
      }
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
    const startTime = performance.now();
    
    // Get the bloom filters for both documents
    const filter1 = this.bloomFilters.get(docId1);
    const filter2 = this.bloomFilters.get(docId2);
    
    // If either filter is missing, return 0
    if (!filter1 || !filter2) {
      if (DEBUG_MODE) {
        if (!filter1) log(`Document ${docId1} not found`);
        if (!filter2) log(`Document ${docId2} not found`);
      }
      return 0;
    }
    
    // Calculate the actual Jaccard similarity
    const similarity = filter1.similarity(filter2);
    
    const endTime = performance.now();
    
    if (DEBUG_MODE) {
      // Calculate the actual n-gram overlap for comparison with the bloom filter estimation
      const ngrams1 = this.documentNgrams.get(docId1);
      const ngrams2 = this.documentNgrams.get(docId2);
      
      if (ngrams1 && ngrams2) {
        // Calculate actual Jaccard similarity of n-grams
        const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
        const union = new Set([...ngrams1, ...ngrams2]);
        const actualSimilarity = intersection.size / union.size;
        
        log(`Similarity calculation for ${docId1} and ${docId2}:
          - Bloom filter similarity: ${(similarity * 100).toFixed(2)}%
          - Actual n-gram Jaccard similarity: ${(actualSimilarity * 100).toFixed(2)}%
          - Estimation error: ${Math.abs(similarity - actualSimilarity).toFixed(4)}
          - Common n-grams: ${intersection.size} of ${ngrams1.size}/${ngrams2.size}
          - Calculation time: ${(endTime - startTime).toFixed(2)}ms`);
      } else {
        log(`Similarity calculation for ${docId1} and ${docId2}: ${(similarity * 100).toFixed(2)}%`);
      }
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
      if (DEBUG_MODE) log(`Query document ${queryDocId} not found`);
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
    
    if (DEBUG_MODE) {
      log(`Found ${sortedResults.length} similar documents to ${queryDocId}:
        - Compared with ${comparisons} documents
        - Threshold: ${threshold}
        - Time: ${(endTime - startTime).toFixed(2)}ms
        - Top matches: ${sortedResults.map(([id, sim]) => 
            `${id} (${(sim * 100).toFixed(1)}%)`).join(', ')}`);
    }
    
    return sortedResults;
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