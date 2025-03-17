/**
 * @file Optimized MinHash-LSH implementation for large document collections
 */

import { TFile, Vault } from 'obsidian';

/**
 * Statistics for the MinHash-LSH implementation
 */
export interface MinHashStats {
  numDocuments: number;
  numHashes: number;
  numBands: number;
  rowsPerBand: number;
  shingleSize: number;
  useWordShingles: boolean;
  totalBuckets: number;
  maxBucketSize: number;
  avgBucketSize: number;
  cacheSize: number;
}

// Type definitions
export interface MinHashConfig {
  numHashes: number;
  numBands: number;
  rowsPerBand: number; // should divide numHashes evenly
  shingleSize: number;
  numBuckets: number; // prime number recommended
  maxFiles?: number;
  useWordShingles?: boolean;
}

// Default configuration
export const DEFAULT_MINHASH_CONFIG: MinHashConfig = {
  numHashes: 100,        // 100 hash functions
  numBands: 20,          // 20 bands
  rowsPerBand: 5,        // 5 rows per band (100 / 20 = 5)
  shingleSize: 3,        // Trigrams
  numBuckets: 4294967311, // Large prime number close to 2^32
  maxFiles: undefined,   // No limit by default
  useWordShingles: true  // Use word-level shingles by default
};

// Basic result for similar document pairs
export interface SimilarDocumentPair {
  file1: TFile;
  file2: TFile;
  estimatedSimilarity: number;
}

/**
 * Utility for creating hash coefficients
 * Creates randomized hash function coefficients for the MinHash algorithm
 * @returns Array of [a, b] pairs for hash functions h(x) = (a*x + b) % p
 */
function createHashCoefficients(numHashes: number): Array<[number, number]> {
  const coefficients: Array<[number, number]> = [];

  // Use a large prime number for hash calculations
  const LARGE_PRIME = 4294967311; // Largest prime under 2^32

  // Initialize random hash functions (a*x + b) % LARGE_PRIME
  for (let i = 0; i < numHashes; i++) {
    // Generate random coefficients (avoid a=0)
    const a = Math.floor(Math.random() * (LARGE_PRIME - 1)) + 1;
    const b = Math.floor(Math.random() * LARGE_PRIME);
    coefficients.push([a, b]);
  }

  return coefficients;
}

/**
 * Compute hash code for a string (djb2 algorithm)
 * This is a simple but effective hash function for strings
 * @param str The string to hash
 * @returns 32-bit integer hash code
 */
function hashString(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
  }
  // Make sure we get a positive value
  return hash >>> 0;
}

/**
 * Generate k-shingles from a string
 * @param text Input text
 * @param k Size of each shingle
 * @param wordLevel Whether to use word-level shingles
 * @returns Set of unique shingles
 */
function generateShingles(text: string, k: number, wordLevel: boolean = false): Set<string> {
  const shingles = new Set<string>();

  if (wordLevel) {
    // Word-level shingles
    const words = text.split(/\s+/);
    if (words.length < k) {
      // If we don't have enough words for a k-shingle, use the whole text
      shingles.add(text);
      return shingles;
    }

    for (let i = 0; i <= words.length - k; i++) {
      const shingle = words.slice(i, i + k).join(' ');
      shingles.add(shingle);
    }
  } else {
    // Character-level shingles
    if (text.length < k) {
      shingles.add(text);
      return shingles;
    }

    for (let i = 0; i <= text.length - k; i++) {
      const shingle = text.slice(i, i + k);
      shingles.add(shingle);
    }
  }

  return shingles;
}

/**
 * The optimized MinHash-LSH implementation
 * Uses a row-based approach for better performance with large document collections
 */
export class MinHashLSH {
  private readonly config: MinHashConfig;
  private readonly vault: Vault;

  // Hash function coefficients
  private readonly hashCoefficients: Array<[number, number]>;

  // Maps from file path to file reference
  private readonly fileMap = new Map<string, TFile>();

  // MinHash signatures for each document (document path -> signature)
  private readonly signatures = new Map<string, Uint32Array>();

  // LSH buckets: bandIdx -> bucketValue -> document paths
  private readonly lshBuckets: Map<number, Map<number, Set<string>>> = new Map();

  // Cache of already computed pair similarities
  private readonly similarityCache = new Map<string, number>();

  constructor(vault: Vault, config: Partial<MinHashConfig> = {}) {
    this.vault = vault;
    this.config = { ...DEFAULT_MINHASH_CONFIG, ...config };

    // Validate configuration
    if (this.config.numHashes % this.config.numBands !== 0) {
      throw new Error(`numHashes (${this.config.numHashes}) must be divisible by numBands (${this.config.numBands})`);
    }

    if (this.config.numHashes !== this.config.numBands * this.config.rowsPerBand) {
      console.warn(`Adjusting rowsPerBand to ${this.config.numHashes / this.config.numBands} to match numHashes and numBands`);
      this.config.rowsPerBand = this.config.numHashes / this.config.numBands;
    }

    // Initialize hash functions
    this.hashCoefficients = createHashCoefficients(this.config.numHashes);

    // Initialize LSH buckets
    for (let i = 0; i < this.config.numBands; i++) {
      this.lshBuckets.set(i, new Map<number, Set<string>>());
    }
  }

  /**
   * Compute MinHash signature for a set of shingles
   * Uses the optimized row-based approach
   * @param shingles Set of shingles from a document
   * @returns MinHash signature (Uint32Array for efficiency)
   */
  private computeSignature(shingles: Set<string>): Uint32Array {
    const { numHashes, numBuckets } = this.config;
    const signature = new Uint32Array(numHashes);

    // Initialize signature with maximum values
    signature.fill(0xFFFFFFFF);

    // Compute min-hash for each shingle
    for (const shingle of shingles) {
      // Compute hash of the shingle
      const shingleHash = hashString(shingle);

      // Apply each hash function to the shingle
      for (let i = 0; i < numHashes; i++) {
        const [a, b] = this.hashCoefficients[i];
        // Compute (a*x + b) % p
        const hashValue = (BigInt(a) * BigInt(shingleHash) + BigInt(b)) % BigInt(numBuckets);
        // Convert back to number (safe because it's always < numBuckets)
        const hashNum = Number(hashValue);

        // Update signature with minimum hash value
        signature[i] = Math.min(signature[i], hashNum);
      }
    }

    return signature;
  }

  /**
   * Compute LSH buckets for a document's signature
   * @param signature MinHash signature
   * @returns Map of band index to bucket hash
   */
  private computeLSHBuckets(signature: Uint32Array): Map<number, number> {
    const { numBands, rowsPerBand, numBuckets } = this.config;
    const buckets = new Map<number, number>();

    // Process each band
    for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
      const startIdx = bandIdx * rowsPerBand;
      const endIdx = startIdx + rowsPerBand;

      // Combine hash values in this band
      let bandHash = 1;
      for (let i = startIdx; i < endIdx; i++) {
        // Combine hashes using a rolling hash technique
        bandHash = (bandHash * 31 + signature[i]) % numBuckets;
      }

      buckets.set(bandIdx, bandHash);
    }

    return buckets;
  }

  /**
   * Add a document to the LSH index
   * @param file The file to add
   * @param content Document content (optional, will be read from vault if not provided)
   */
  public async addDocument(file: TFile, content?: string): Promise<void> {
    try {
      // Read and preprocess the document
      if (!content) {
        content = await this.vault.cachedRead(file);
      }

      // Generate shingles
      const shingles = generateShingles(
        content,
        this.config.shingleSize,
        this.config.useWordShingles
      );

      // Compute MinHash signature
      const signature = this.computeSignature(shingles);

      // Compute LSH buckets
      const buckets = this.computeLSHBuckets(signature);

      // Store the file reference
      this.fileMap.set(file.path, file);

      // Store the signature
      this.signatures.set(file.path, signature);

      // Add to LSH buckets
      for (const [bandIdx, bucketValue] of buckets.entries()) {
        const bandBuckets = this.lshBuckets.get(bandIdx)!;

        if (!bandBuckets.has(bucketValue)) {
          bandBuckets.set(bucketValue, new Set<string>());
        }

        bandBuckets.get(bucketValue)!.add(file.path);
      }
    } catch (error) {
      console.error(`Error processing ${file.path}:`, error);
    }
  }

  /**
   * Remove a document from the LSH index
   * @param filePath Path of the file to remove
   */
  public removeDocument(filePath: string): void {
    // Get the signature
    const signature = this.signatures.get(filePath);
    if (!signature) return;

    // Compute LSH buckets
    const buckets = this.computeLSHBuckets(signature);

    // Remove from LSH buckets
    for (const [bandIdx, bucketValue] of buckets.entries()) {
      const bandBuckets = this.lshBuckets.get(bandIdx);
      if (!bandBuckets) continue;

      const bucket = bandBuckets.get(bucketValue);
      if (!bucket) continue;

      bucket.delete(filePath);

      // Clean up empty buckets
      if (bucket.size === 0) {
        bandBuckets.delete(bucketValue);
      }
    }

    // Remove signature
    this.signatures.delete(filePath);

    // Remove from file map
    this.fileMap.delete(filePath);

    // Clear cache entries involving this file
    for (const cacheKey of this.similarityCache.keys()) {
      if (cacheKey.includes(filePath)) {
        this.similarityCache.delete(cacheKey);
      }
    }
  }

  /**
   * Update a document in the LSH index
   * @param file The file to update
   * @param content Document content (optional, will be read from vault if not provided)
   */
  public async updateDocument(file: TFile, content?: string): Promise<void> {
    // Remove the old document
    this.removeDocument(file.path);

    // Add the updated document
    await this.addDocument(file, content);
  }

  /**
   * Initialize the LSH index with all documents in the vault
   * @param progressCallback Optional callback for progress reporting
   */
  public async initialize(
    progressCallback?: (processed: number, total: number) => void
  ): Promise<void> {
    // Get all markdown files
    let files = this.vault.getMarkdownFiles();

    // Apply limit if configured
    if (this.config.maxFiles && files.length > this.config.maxFiles) {
      files = files.slice(0, this.config.maxFiles);
    }

    // Process files in batches to avoid UI blocking
    const BATCH_SIZE = 5;
    for (let i = 0; i < files.length; i += BATCH_SIZE) {
      const batch = files.slice(i, i + BATCH_SIZE);

      // Process batch in parallel
      await Promise.all(batch.map(file => this.addDocument(file)));

      // Report progress
      if (progressCallback) {
        progressCallback(i + batch.length, files.length);
      }

      // Yield to main thread to avoid UI blocking
      await this.yieldToMain();
    }
  }

  /**
   * Find candidate similar documents for a given file
   * @param file The file to find similar documents for
   * @returns Array of candidate similar files
   */
  public findSimilarDocuments(file: TFile): TFile[] {
    const filePath = file.path;

    // Check if the file is in our index
    if (!this.signatures.has(filePath)) {
      // If not, we can't find similar documents
      return [];
    }

    // Get the signature
    const signature = this.signatures.get(filePath)!;

    // Compute LSH buckets
    const buckets = this.computeLSHBuckets(signature);

    // Find candidate documents that share at least one bucket
    const candidates = new Set<string>();

    for (const [bandIdx, bucketValue] of buckets.entries()) {
      const bandBuckets = this.lshBuckets.get(bandIdx);
      if (!bandBuckets) continue;

      const bucket = bandBuckets.get(bucketValue);
      if (!bucket) continue;

      // Add all documents in this bucket (except the query document)
      for (const docPath of bucket) {
        if (docPath !== filePath) {
          candidates.add(docPath);
        }
      }
    }

    // Convert candidate paths to TFile objects
    return Array.from(candidates)
      .map(path => this.fileMap.get(path))
      .filter((file): file is TFile => file !== undefined);
  }

  /**
   * Calculate the Jaccard similarity between two signatures
   * @param sig1 First signature
   * @param sig2 Second signature
   * @returns Estimated Jaccard similarity
   */
  private calculateSignatureSimilarity(sig1: Uint32Array, sig2: Uint32Array): number {
    // The similarity is the fraction of hash functions where the two signatures agree
    let matches = 0;

    for (let i = 0; i < sig1.length; i++) {
      if (sig1[i] === sig2[i]) {
        matches++;
      }
    }

    return matches / sig1.length;
  }

  /**
   * Find similar documents with similarity scores
   * @param file The file to find similar documents for
   * @param minSimilarity Minimum similarity threshold (0-1)
   * @param limit Maximum number of results to return
   * @returns Array of similar documents with similarity scores
   */
  public findSimilarDocumentsWithScores(
    file: TFile,
    minSimilarity: number = 0.3,
    limit: number = 10
  ): SimilarDocumentPair[] {
    const filePath = file.path;

    // If we don't have the file in our index, return empty results
    if (!this.signatures.has(filePath)) {
      return [];
    }

    const fileSignature = this.signatures.get(filePath)!;

    // Find candidate documents
    const candidates = this.findSimilarDocuments(file);

    // Calculate similarity for each candidate
    const results: SimilarDocumentPair[] = [];

    for (const candidateFile of candidates) {
      const candidatePath = candidateFile.path;

      // Generate a cache key for this pair
      const cacheKey = [filePath, candidatePath].sort().join('::');

      // Check cache first
      let similarity: number;
      if (this.similarityCache.has(cacheKey)) {
        similarity = this.similarityCache.get(cacheKey)!;
      } else {
        // Calculate similarity
        const candidateSignature = this.signatures.get(candidatePath)!;
        similarity = this.calculateSignatureSimilarity(fileSignature, candidateSignature);

        // Cache the result
        this.similarityCache.set(cacheKey, similarity);
      }

      // Filter by minimum similarity
      if (similarity >= minSimilarity) {
        results.push({
          file1: file,
          file2: candidateFile,
          estimatedSimilarity: similarity
        });
      }
    }

    // Sort by similarity (highest first) and limit results
    return results
      .sort((a, b) => b.estimatedSimilarity - a.estimatedSimilarity)
      .slice(0, limit);
  }

  /**
   * Get statistics about the LSH index
   * @returns Object with statistics
   */
  public getStats(): MinHashStats {
    let totalBuckets = 0;
    let maxBucketSize = 0;
    let totalBucketSize = 0;

    // Count buckets and sizes
    for (const bandBuckets of this.lshBuckets.values()) {
      totalBuckets += bandBuckets.size;

      for (const bucket of bandBuckets.values()) {
        maxBucketSize = Math.max(maxBucketSize, bucket.size);
        totalBucketSize += bucket.size;
      }
    }

    const avgBucketSize = totalBuckets > 0 ? totalBucketSize / totalBuckets : 0;

    return {
      numDocuments: this.signatures.size,
      numHashes: this.config.numHashes,
      numBands: this.config.numBands,
      rowsPerBand: this.config.rowsPerBand,
      shingleSize: this.config.shingleSize,
      useWordShingles: !!this.config.useWordShingles,
      totalBuckets,
      maxBucketSize,
      avgBucketSize,
      cacheSize: this.similarityCache.size
    };
  }

  /**
   * Yield to the main thread to avoid UI blocking
   */
  private async yieldToMain(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}