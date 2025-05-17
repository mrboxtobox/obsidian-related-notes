/**
 * @file SimHash implementation for extremely efficient document similarity
 */

import { TFile, Vault } from 'obsidian';

/**
 * Statistics for the SimHash implementation
 */
export interface SimHashStats {
  numDocuments: number;
  memoryUsageBytes: number;
  indexingTimeMs: number;
  avgQueryTimeMs: number;
}

/**
 * Configuration for SimHash
 */
export interface SimHashConfig {
  hashBits: number;      // Number of bits in the hash (64 or 128)
  shingleSize: number;   // Size of word shingles 
  maxDistance: number;   // Maximum hamming distance to consider similar
  useChunkIndex: boolean; // Whether to use chunk-based indexing
  chunkCount: number;    // Number of chunks to divide the hash into
}

// Default configuration
export const DEFAULT_SIMHASH_CONFIG: SimHashConfig = {
  hashBits: 64,       // 64-bit hash by default
  shingleSize: 2,     // Use bigrams by default
  maxDistance: 10,    // Default max hamming distance
  useChunkIndex: true,// Use chunk indexing for faster queries
  chunkCount: 4       // Divide 64-bit hash into 4 chunks of 16 bits each
};

/**
 * Simple similarity result
 */
export interface SimHashSimilarity {
  file: TFile;
  distance: number;
  similarity: number; // Normalized similarity score (0-1)
}

/**
 * Compute hash code for a string (FNV-1a algorithm)
 * This is a fast, high-quality hash function with excellent distribution
 * @param str The string to hash
 * @returns 32-bit integer hash code
 */
function hashString(str: string): number {
  // FNV-1a constants (32-bit)
  const FNV_PRIME = 16777619;
  const FNV_OFFSET_BASIS = 2166136261;
  
  let hash = FNV_OFFSET_BASIS;
  
  // Process 4 characters at a time when possible (optimization)
  const len = str.length;
  let i = 0;
  
  // Fast path: process 4 characters at once
  while (i + 4 <= len) {
    // Use bit operations for faster computation
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i + 1);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i + 2);
    hash = Math.imul(hash, FNV_PRIME);
    
    hash ^= str.charCodeAt(i + 3);
    hash = Math.imul(hash, FNV_PRIME);
    
    i += 4;
  }
  
  // Handle remaining characters (1-3)
  while (i < len) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
    i++;
  }
  
  // Make sure we get a positive value
  return hash >>> 0;
}

/**
 * Generate a SimHash fingerprint from text
 * @param text Input text
 * @param config SimHash configuration
 * @returns Promise with SimHash fingerprint as a BigInt
 */
async function generateSimHash(text: string, config: SimHashConfig): Promise<bigint> {
  // 1. Tokenize text into shingles
  const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  
  // If not enough words, return a simple hash
  if (words.length < config.shingleSize) {
    return BigInt(hashString(text)) & ((BigInt(1) << BigInt(config.hashBits)) - BigInt(1));
  }
  
  // 2. Create shingles and hash them
  const shingles = new Map<string, number>();
  
  // Use batching for large documents to avoid UI blocking
  const SHINGLING_BATCH_SIZE = 1000;
  for (let i = 0; i <= words.length - config.shingleSize; i++) {
    const shingle = words.slice(i, i + config.shingleSize).join(' ');
    shingles.set(shingle, (shingles.get(shingle) || 0) + 1);
    
    // Yield to main thread periodically for large documents
    if (words.length > SHINGLING_BATCH_SIZE && i % SHINGLING_BATCH_SIZE === 0) {
      await yieldToMain();
    }
  }
  
  // 3. Initialize feature vector (V)
  const V = new Int32Array(config.hashBits).fill(0);
  
  // 4. Update V for each shingle (with batching for large documents)
  let shingleCount = 0;
  for (const [shingle, weight] of shingles.entries()) {
    // Hash the shingle
    const hash = hashString(shingle);
    
    // Update each bit position based on shingle hash
    for (let i = 0; i < config.hashBits; i++) {
      // If bit i of hash is 1, add weight; otherwise subtract
      const bit = (hash & (1 << (i % 32))) !== 0;
      V[i] += bit ? weight : -weight;
    }
    
    // Yield to main thread periodically for large shingle sets
    shingleCount++;
    if (shingles.size > SHINGLING_BATCH_SIZE && shingleCount % SHINGLING_BATCH_SIZE === 0) {
      await yieldToMain();
    }
  }
  
  // 5. Generate final fingerprint
  let fingerprint = BigInt(0);
  for (let i = 0; i < config.hashBits; i++) {
    if (V[i] > 0) {
      fingerprint |= BigInt(1) << BigInt(i);
    }
  }
  
  return fingerprint;
}

/**
 * Yield to the main thread to avoid UI blocking
 */
async function yieldToMain(): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, 0));
}

/**
 * Split a hash into chunks for indexing
 * @param hash Hash value to split
 * @param chunkCount Number of chunks
 * @param bitsPerChunk Number of bits per chunk
 * @returns Array of chunk values
 */
function splitHashIntoChunks(hash: bigint, chunkCount: number, bitsPerChunk: number): Uint16Array {
  const chunks = new Uint16Array(chunkCount);
  const mask = (BigInt(1) << BigInt(bitsPerChunk)) - BigInt(1);
  
  for (let i = 0; i < chunkCount; i++) {
    const chunk = Number((hash >> BigInt(i * bitsPerChunk)) & mask);
    chunks[i] = chunk;
  }
  
  return chunks;
}

/**
 * Calculate Hamming distance between two bigints
 * This implementation uses a lookup-based popcount for better performance
 * @param a First bigint
 * @param b Second bigint
 * @returns Hamming distance (number of differing bits)
 */
function hammingDistance(a: bigint, b: bigint): number {
  // XOR the values - bits that differ will be 1
  let xor = a ^ b;
  
  // Convert to binary string
  const binaryStr = xor.toString(2);
  
  // Count the number of 1 bits (popcount)
  // More efficient than bit shifting in JavaScript
  let distance = 0;
  for (let i = 0; i < binaryStr.length; i++) {
    if (binaryStr[i] === '1') {
      distance++;
    }
  }
  
  return distance;
}

/**
 * The SimHash implementation for efficient document similarity
 */
export class SimHash {
  private readonly config: SimHashConfig;
  private readonly vault: Vault;
  
  // Document hashes (document path -> SimHash)
  private readonly documentHashes = new Map<string, bigint>();
  
  // Maps from file path to file reference
  private readonly fileMap = new Map<string, TFile>();
  
  // Chunk-based index (for faster similarity lookup)
  private readonly chunkIndex: Map<number, Map<number, Set<string>>> = new Map();
  
  // Performance metrics
  private totalIndexingTime = 0;
  private totalQueryTime = 0;
  private queryCount = 0;
  
  constructor(vault: Vault, config: Partial<SimHashConfig> = {}) {
    this.vault = vault;
    this.config = { ...DEFAULT_SIMHASH_CONFIG, ...config };
    
    // Initialize chunk index if enabled
    if (this.config.useChunkIndex) {
      const bitsPerChunk = Math.floor(this.config.hashBits / this.config.chunkCount);
      for (let i = 0; i < this.config.chunkCount; i++) {
        this.chunkIndex.set(i, new Map<number, Set<string>>());
      }
    }
  }
  
  /**
   * Add a document to the index
   * @param file The file to add
   * @param content Document content (optional, will be read from vault if not provided)
   */
  public async addDocument(file: TFile, content?: string): Promise<void> {
    const startTime = performance.now();
    
    try {
      // Remove document first if it already exists (update case)
      this.removeDocument(file.path);
      
      // Read content if not provided
      if (!content) {
        content = await this.vault.cachedRead(file);
      }
      
      // Generate SimHash for the document (now async)
      const hash = await generateSimHash(content, this.config);
      
      // Store document hash
      this.documentHashes.set(file.path, hash);
      
      // Store file reference
      this.fileMap.set(file.path, file);
      
      // Add to chunk index if enabled
      if (this.config.useChunkIndex) {
        this.indexDocumentChunks(file.path, hash);
      }
    } catch (error) {
      console.error(`Error processing ${file.path}:`, error);
    }
    
    // Track indexing time
    this.totalIndexingTime += performance.now() - startTime;
  }
  
  /**
   * Index document chunks for faster similarity lookup
   * @param filePath The document path
   * @param hash The document's SimHash
   */
  private indexDocumentChunks(filePath: string, hash: bigint): void {
    const bitsPerChunk = Math.floor(this.config.hashBits / this.config.chunkCount);
    const chunks = splitHashIntoChunks(hash, this.config.chunkCount, bitsPerChunk);
    
    // Add document to each chunk's index
    for (let i = 0; i < chunks.length; i++) {
      const chunkValue = chunks[i];
      const chunkBuckets = this.chunkIndex.get(i)!;
      
      if (!chunkBuckets.has(chunkValue)) {
        chunkBuckets.set(chunkValue, new Set<string>());
      }
      
      chunkBuckets.get(chunkValue)!.add(filePath);
    }
  }
  
  /**
   * Remove a document from the index
   * @param filePath Path of the file to remove
   */
  public removeDocument(filePath: string): void {
    // Get document hash
    const hash = this.documentHashes.get(filePath);
    if (!hash) return;
    
    // Remove from chunk index if enabled
    if (this.config.useChunkIndex) {
      this.removeDocumentChunks(filePath, hash);
    }
    
    // Remove document hash
    this.documentHashes.delete(filePath);
    
    // Remove file reference
    this.fileMap.delete(filePath);
  }
  
  /**
   * Remove document chunks from the index
   * @param filePath The document path
   * @param hash The document's SimHash
   */
  private removeDocumentChunks(filePath: string, hash: bigint): void {
    const bitsPerChunk = Math.floor(this.config.hashBits / this.config.chunkCount);
    const chunks = splitHashIntoChunks(hash, this.config.chunkCount, bitsPerChunk);
    
    // Remove document from each chunk's index
    for (let i = 0; i < chunks.length; i++) {
      const chunkValue = chunks[i];
      const chunkBuckets = this.chunkIndex.get(i);
      if (!chunkBuckets) continue;
      
      const bucket = chunkBuckets.get(chunkValue);
      if (!bucket) continue;
      
      bucket.delete(filePath);
      
      // Remove empty buckets
      if (bucket.size === 0) {
        chunkBuckets.delete(chunkValue);
      }
    }
  }
  
  /**
   * Update a document in the index
   * @param file The file to update
   * @param content Document content (optional)
   */
  public async updateDocument(file: TFile, content?: string): Promise<void> {
    // Just use addDocument which already handles updates
    await this.addDocument(file, content);
  }
  
  /**
   * Find similar documents for a given file
   * @param file The file to find similar documents for
   * @param maxDistance Maximum Hamming distance
   * @param limit Maximum number of results
   * @returns Array of similar documents with distance scores
   */
  public findSimilarDocuments(
    file: TFile,
    maxDistance: number = this.config.maxDistance,
    limit: number = 10
  ): SimHashSimilarity[] {
    const startTime = performance.now();
    
    const results: SimHashSimilarity[] = [];
    const filePath = file.path;
    
    // Get document hash
    const hash = this.documentHashes.get(filePath);
    if (!hash) return [];
    
    if (this.config.useChunkIndex) {
      // Use chunk-based index for faster lookup
      results.push(...this.findSimilarWithChunks(filePath, hash, maxDistance));
    } else {
      // Brute-force comparison (slower for large collections)
      results.push(...this.findSimilarBruteForce(filePath, hash, maxDistance));
    }
    
    // Normalize similarity scores (0 = maxDistance, 1 = identical)
    for (const result of results) {
      result.similarity = 1 - (result.distance / this.config.hashBits);
    }
    
    // Sort by distance (ascending) and limit results
    const limitedResults = results
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit);
    
    // Track query performance
    this.totalQueryTime += performance.now() - startTime;
    this.queryCount++;
    
    return limitedResults;
  }
  
  /**
   * Find similar documents using chunk-based index
   * @param filePath Path of the query document
   * @param hash SimHash of the query document
   * @param maxDistance Maximum Hamming distance
   * @returns Array of similar documents with distance scores
   */
  private findSimilarWithChunks(
    filePath: string, 
    hash: bigint,
    maxDistance: number
  ): SimHashSimilarity[] {
    const bitsPerChunk = Math.floor(this.config.hashBits / this.config.chunkCount);
    const chunks = splitHashIntoChunks(hash, this.config.chunkCount, bitsPerChunk);
    
    // Collect candidate documents that match at least one chunk
    const candidates = new Map<string, number>(); // filePath -> matching chunks
    
    // For each chunk
    for (let i = 0; i < chunks.length; i++) {
      const chunkValue = chunks[i];
      const chunkBuckets = this.chunkIndex.get(i)!;
      
      // Get documents with matching chunk
      const bucket = chunkBuckets.get(chunkValue);
      if (bucket) {
        for (const docPath of bucket) {
          if (docPath !== filePath) {
            candidates.set(docPath, (candidates.get(docPath) || 0) + 1);
          }
        }
      }
      
      // Optionally: get documents with similar chunks (1-2 bit differences)
      // This improves recall but adds more computation
      // Implementation omitted for brevity
    }
    
    // Calculate actual Hamming distances for candidates
    const results: SimHashSimilarity[] = [];
    
    for (const [docPath, matchingChunks] of candidates.entries()) {
      // Filter candidates that don't have enough matching chunks
      // Pigeonhole principle: if ham distance ≤ d, at least k-⌈d/r⌉ chunks must match
      // where k is chunk count and r is bits per chunk
      const minRequiredChunks = this.config.chunkCount - Math.ceil(maxDistance / bitsPerChunk);
      if (matchingChunks < minRequiredChunks) continue;
      
      const docHash = this.documentHashes.get(docPath);
      if (!docHash) continue;
      
      const distance = hammingDistance(hash, docHash);
      if (distance <= maxDistance) {
        const docFile = this.fileMap.get(docPath)!;
        results.push({
          file: docFile,
          distance,
          similarity: 0 // Will be normalized later
        });
      }
    }
    
    return results;
  }
  
  /**
   * Find similar documents by comparing with all documents (brute force)
   * @param filePath Path of the query document
   * @param hash SimHash of the query document
   * @param maxDistance Maximum Hamming distance
   * @returns Array of similar documents with distance scores
   */
  private findSimilarBruteForce(
    filePath: string, 
    hash: bigint,
    maxDistance: number
  ): SimHashSimilarity[] {
    const results: SimHashSimilarity[] = [];
    
    // Compare with all other documents
    for (const [docPath, docHash] of this.documentHashes.entries()) {
      if (docPath === filePath) continue;
      
      const distance = hammingDistance(hash, docHash);
      if (distance <= maxDistance) {
        const docFile = this.fileMap.get(docPath)!;
        results.push({
          file: docFile,
          distance,
          similarity: 0 // Will be normalized later
        });
      }
    }
    
    return results;
  }
  
  /**
   * Check if a file is indexed in the SimHash index
   * @param file The file to check
   * @returns True if the file is indexed, false otherwise
   */
  public isFileIndexed(file: TFile): boolean {
    return this.documentHashes.has(file.path);
  }

  /**
   * Initialize the index with prioritized documents from the vault
   * Uses a progressive approach that ensures high-priority documents are indexed first,
   * and others are indexed on-demand as they're accessed
   * @param progressCallback Optional callback for progress reporting
   */
  public async initialize(
    progressCallback?: (processed: number, total: number) => void
  ): Promise<void> {
    const startTime = performance.now();
    
    // Get all markdown files
    const allFiles = this.vault.getMarkdownFiles();
    
    // Determine maximum files to index during initialization
    // For very large vaults, we prioritize recent files
    const MAX_INITIAL_FILES = 10000;
    const needsPrioritization = allFiles.length > MAX_INITIAL_FILES;
    
    let filesToProcess = allFiles;
    
    if (needsPrioritization) {
      // Sort files by modification time (most recent first)
      filesToProcess = [...allFiles].sort((a, b) => b.stat.mtime - a.stat.mtime);
      
      // Take a subset of prioritized files
      filesToProcess = filesToProcess.slice(0, MAX_INITIAL_FILES);
    }
    
    // Process files in batches to avoid UI blocking
    const BATCH_SIZE = 10; // Larger batch size than MinHash (SimHash is faster)
    for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
      const batch = filesToProcess.slice(i, i + BATCH_SIZE);
      
      // Process batch in parallel
      await Promise.all(batch.map(file => this.addDocument(file)));
      
      // Report progress
      if (progressCallback) {
        // Report progress against total files being processed now
        const processed = Math.min(i + batch.length, filesToProcess.length);
        const percentage = Math.floor((processed / filesToProcess.length) * 100);
        progressCallback(percentage, 100);
      }
      
      // Yield to main thread to avoid UI blocking
      await this.yieldToMain();
    }
    
    // Reset performance counters after initialization
    this.totalIndexingTime = performance.now() - startTime;
    this.totalQueryTime = 0;
    this.queryCount = 0;
  }
  
  /**
   * Get statistics about the index
   * @returns Object with statistics
   */
  public getStats(): SimHashStats {
    // Calculate memory usage
    let memoryUsageBytes = 0;
    
    // Document hashes: ~8-16 bytes per document (64-128 bits)
    memoryUsageBytes += this.documentHashes.size * (this.config.hashBits / 8);
    
    // FileMap: ~100 bytes per entry (rough estimate including TFile overhead)
    memoryUsageBytes += this.fileMap.size * 100;
    
    // Chunk index: estimate based on number of entries
    if (this.config.useChunkIndex) {
      let totalBucketEntries = 0;
      for (const [_, chunkBuckets] of this.chunkIndex.entries()) {
        for (const [_, bucket] of chunkBuckets.entries()) {
          totalBucketEntries += bucket.size;
        }
      }
      // Each entry in a bucket is a string reference (~4-8 bytes)
      memoryUsageBytes += totalBucketEntries * 6;
    }
    
    return {
      numDocuments: this.documentHashes.size,
      memoryUsageBytes,
      indexingTimeMs: this.totalIndexingTime,
      avgQueryTimeMs: this.queryCount > 0 ? this.totalQueryTime / this.queryCount : 0
    };
  }
  
  /**
   * Yield to the main thread to avoid UI blocking
   */
  private async yieldToMain(): Promise<void> {
    return new Promise<void>(resolve => setTimeout(resolve, 0));
  }
}