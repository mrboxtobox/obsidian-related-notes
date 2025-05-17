/**
 * @file Similarity provider interface and implementations
 */

import { TFile, Vault } from 'obsidian';
import { SimHash, SimHashStats, SimHashConfig } from './simhash';

/**
 * Interface for similarity information
 */
export interface SimilarityInfo {
  similarity: number;
  file?: TFile;
  distance?: number;
}

/**
 * Interface for similarity providers
 */
export interface SimilarityProvider {
  /**
   * Find candidate files that may be similar to the given file
   * @param file The file to find candidates for
   * @returns Array of candidate similar files
   */
  getCandidateFiles(file: TFile): TFile[];
  
  /**
   * Compute the similarity between two files
   * @param file1 First file
   * @param file2 Second file
   * @returns Object with similarity information
   */
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
  
  /**
   * Initialize the similarity provider with all files in the vault
   * @param progressCallback Optional callback for progress reporting
   */
  initialize(progressCallback?: (processed: number, total: number) => void): Promise<void>;
  
  /**
   * Add a document to the index
   * @param file The file to add
   * @param content Optional content (will be read from vault if not provided)
   */
  addDocument(file: TFile, content?: string): Promise<void>;
  
  /**
   * Remove a document from the index
   * @param filePath Path of the file to remove
   */
  removeDocument(filePath: string): void;
  
  /**
   * Update a document in the index
   * @param file The file to update
   * @param content Optional content (will be read from vault if not provided)
   */
  updateDocument(file: TFile, content?: string): Promise<void>;
  
  /**
   * Check if a file is already indexed
   * @param file The file to check
   * @returns True if the file is already indexed, false otherwise
   */
  isFileIndexed(file: TFile): boolean;
}

/**
 * Configuration for SimHash-based similarity provider
 */
export interface SimHashProviderConfig {
  simhash?: Partial<SimHashConfig>;
  similarityThreshold?: number;
  maxRelatedNotes?: number;
}

/**
 * SimHash-based similarity provider
 * Uses SimHash for fast similarity detection
 */
export class SimHashProvider implements SimilarityProvider {
  private readonly vault: Vault;
  private readonly simhash: SimHash;
  private readonly similarityThreshold: number;
  private readonly maxRelatedNotes: number;
  
  // Track file access times for prioritization
  private readonly fileAccessTimes = new Map<string, number>();
  
  // Whether initialization is complete
  private isInitialized = false;
  
  // Whether the corpus is sampled (limited to maxFiles)
  private _isCorpusSampled = false;
  
  // Track on-demand indexing statistics
  private _onDemandIndexedCount = 0;
  
  // Map from file path to common terms (for display)
  private readonly commonTermsCache = new Map<string, Map<string, string[]>>();
  
  constructor(vault: Vault, config: SimHashProviderConfig = {}) {
    this.vault = vault;
    this.simhash = new SimHash(vault, config.simhash);
    this.similarityThreshold = config.similarityThreshold || 0.3;
    this.maxRelatedNotes = config.maxRelatedNotes || 10;
  }
  
  /**
   * Find candidate files that may be similar to the given file
   * @param file The file to find candidates for
   * @returns Array of candidate similar files
   */
  public getCandidateFiles(file: TFile): TFile[] {
    // SimHash directly finds similar files
    const maxDistance = Math.floor((1 - this.similarityThreshold) * 64); // For 64-bit SimHash
    const similars = this.simhash.findSimilarDocuments(file, maxDistance, this.maxRelatedNotes);
    return similars.map(item => item.file);
  }
  
  /**
   * Compute the similarity between two files
   * @param file1 First file
   * @param file2 Second file
   * @returns Object with similarity information
   */
  public async computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo> {
    // SimHash already computes similarity during findSimilarDocuments
    // But for direct comparison, we can use the SimHash values to compute a similarity score
    
    // Get the SimHash values from the index (accessing private property)
    const documentHashes = (this.simhash as any).documentHashes;
    const hash1 = documentHashes.get(file1.path);
    const hash2 = documentHashes.get(file2.path);
    
    if (!hash1 || !hash2) {
      return { similarity: 0 };
    }
    
    // Compute Hamming distance using BigInt operations
    const xorBigInt = hash1 ^ hash2;
    let distance = 0;
    
    // Convert to binary string and count the 1s
    const binaryStr = xorBigInt.toString(2);
    for (let i = 0; i < binaryStr.length; i++) {
      if (binaryStr[i] === '1') {
        distance++;
      }
    }
    
    // Convert distance to similarity (0-1 range, where 1 is identical)
    const hashBits = (this.simhash as any).config.hashBits;
    const similarity = 1 - (distance / hashBits);
    
    return { 
      similarity,
      file: file2,
      distance
    };
  }
  
  /**
   * Initialize the similarity provider with all files in the vault
   * @param progressCallback Optional callback for progress reporting
   */
  public async initialize(progressCallback?: (processed: number, total: number) => void): Promise<void> {
    // Get all markdown files
    const allFiles = this.vault.getMarkdownFiles();
    
    // Determine if corpus is large (more than 10000 files)
    this._isCorpusSampled = allFiles.length > 10000;
    
    await this.simhash.initialize(progressCallback);
    this.isInitialized = true;
  }
  
  /**
   * Update the access time for a file
   * This is used for prioritizing files
   * @param file The file to update
   */
  public updateFileAccessTime(file: TFile): void {
    this.fileAccessTimes.set(file.path, Date.now());
  }
  
  /**
   * Check if the corpus is sampled (limited to a subset of all files)
   */
  public isCorpusSampled(): boolean {
    return this._isCorpusSampled;
  }
  
  /**
   * Force a full reindexing of all documents
   * @param onProgress Optional callback for progress reporting
   */
  public async forceReindex(onProgress?: (processed: number, total: number) => void): Promise<void> {
    // Clear cache
    this.commonTermsCache.clear();
    
    // Instead of recreating the SimHash, we'll just reinitialize it
    // since the simhash property is readonly
    
    // Reinitialize by recreating the internal data structures
    (this.simhash as any).documentHashes.clear();
    (this.simhash as any).fileMap.clear();
    
    if ((this.simhash as any).chunkIndex) {
      for (const [key, value] of (this.simhash as any).chunkIndex.entries()) {
        value.clear();
      }
    }
    
    // Reinitialize
    this.isInitialized = false;
    await this.initialize(onProgress);
  }
  
  /**
   * Add a document to the index
   * @param file The file to add
   * @param content Optional content (will be read from vault if not provided)
   */
  public async addDocument(file: TFile, content?: string): Promise<void> {
    // Check if the file is already indexed
    if (!this.isFileIndexed(file)) {
      // If not, this is an on-demand indexing
      if (this.isInitialized) {
        this._onDemandIndexedCount++;
      }
    }
    
    await this.simhash.addDocument(file, content);
  }
  
  /**
   * Remove a document from the index
   * @param filePath Path of the file to remove
   */
  public removeDocument(filePath: string): void {
    this.simhash.removeDocument(filePath);
  }
  
  /**
   * Update a document in the index
   * @param file The file to update
   * @param content Optional content (will be read from vault if not provided)
   */
  public async updateDocument(file: TFile, content?: string): Promise<void> {
    await this.simhash.updateDocument(file, content);
  }
  
  /**
   * Check if a file is indexed in the SimHash provider
   * @param file File to check
   * @returns True if the file is indexed, false otherwise
   */
  public isFileIndexed(file: TFile): boolean {
    return (this.simhash as any).documentHashes.has(file.path);
  }
  
  /**
   * Get the number of files indexed on-demand (after initial indexing)
   * @returns Number of files indexed on-demand
   */
  public getOnDemandIndexedCount(): number {
    return this._onDemandIndexedCount;
  }
  
  /**
   * Get statistics about the SimHash index
   * @returns Object with statistics
   */
  public getStats(): SimHashStats {
    return this.simhash.getStats();
  }
  
  /**
   * Get statistics about the provider
   * @returns Object with statistics
   */
  public getStatistics(): any {
    const simhashStats = this.simhash.getStats();
    
    // Calculate some additional stats that SimHash doesn't provide directly
    let totalBuckets = 0;
    let maxBucketSize = 0;
    let totalBucketEntries = 0;
    
    if ((this.simhash as any).config.useChunkIndex) {
      const chunkIndex = (this.simhash as any).chunkIndex;
      for (const [_, chunkBuckets] of chunkIndex.entries()) {
        totalBuckets += chunkBuckets.size;
        
        for (const [_, bucket] of chunkBuckets.entries()) {
          maxBucketSize = Math.max(maxBucketSize, bucket.size);
          totalBucketEntries += bucket.size;
        }
      }
    }
    
    const avgBucketSize = totalBuckets > 0 ? totalBucketEntries / totalBuckets : 0;
    
    return {
      isInitialized: this.isInitialized,
      isCorpusSampled: this._isCorpusSampled,
      commonTermsCacheSize: this.commonTermsCache.size,
      fileAccessTimesCount: this.fileAccessTimes.size,
      similarityThreshold: this.similarityThreshold,
      numDocuments: simhashStats.numDocuments || 0,
      shingleSize: (this.simhash as any).config.shingleSize || 2,
      numHashes: 1, // SimHash uses a single hash function
      useWordShingles: true,
      totalBuckets: totalBuckets,
      maxBucketSize: maxBucketSize,
      avgBucketSize: avgBucketSize,
      onDemandIndexedCount: this._onDemandIndexedCount,
      totalIndexedCount: simhashStats.numDocuments || 0
    };
  }
}