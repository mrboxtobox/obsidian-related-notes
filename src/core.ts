/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
* Includes smart caching to improve performance and reduce token usage.
*/

import { Vault, TFile } from 'obsidian';
import { MinHashConfig, MinHashLSH, MinHashStats } from './minhash';


'use strict';

const FREQUENCY_CAP = 10;
const CACHE_VERSION = 1;

export interface RelatedNote {
  file: TFile;
  similarity: number;
  commonTerms?: string[]; // Common terms between the notes
}

export interface SimilarityInfo {
  similarity: number;
  commonTerms?: string[]; // Add common terms to the similarity info
}

/**
 * Statistics for the classic similarity provider
 */
export interface ClassicProviderStats {
  vocabularySize: number;
  fileVectorsCount: number;
  signaturesCount: number;
  relatedNotesCount: number;
  isCorpusSampled: boolean;
  numBands: number;
  rowsPerBand: number;
  avgShingleSize: number;
  avgDocLength: number;
  avgSimilarityScore: number;
}

export interface SimilarityProvider {
  initialize(onProgress?: (processed: number) => void): Promise<void>;
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
  updateFileAccessTime(file: TFile): void;
  isCorpusSampled(): boolean;
  forceReindex(onProgress?: (processed: number) => void): Promise<void>
  getStatistics(): ProviderStatistics;

}

export interface CacheData {
  version: number;
  lastUpdated: number;
  fileVectors: Record<string, string[]>;
  signatures: Record<string, number[]>;
  relatedNotes: Record<string, string[]>;
  fileMetadata: Record<string, { mtime: number; size: number }>;
}

/**
 * Statistics for the similarity provider
 */
export interface ProviderStatistics {
  isInitialized: boolean;
  isCorpusSampled: boolean;
  commonTermsCacheSize: number;
  fileAccessTimesCount: number;
  similarityThreshold: number;
  numDocuments?: number;
  numHashes?: number;
  shingleSize?: number;
  useWordShingles?: boolean;
  numBands?: number;
  rowsPerBand?: number;
  totalBuckets?: number;
  maxBucketSize?: number;
  avgBucketSize?: number;
}

/**
 * Configuration for the optimized similarity provider
 */
export interface OptimizedSimilarityConfig {
  minhash: Partial<MinHashConfig>;
  similarityThreshold: number;
  maxRelatedNotes: number;
  cacheFilePath: string;
  largeCorpusThreshold: number;
}

/**
 * Default configuration for the optimized similarity provider
 */
export const DEFAULT_OPTIMIZED_SIMILARITY_CONFIG: OptimizedSimilarityConfig = {
  minhash: {
    numHashes: 100,
    numBands: 20,
    rowsPerBand: 5,
    shingleSize: 3,
    useWordShingles: true
  },
  similarityThreshold: 0.3,
  maxRelatedNotes: 10,
  cacheFilePath: 'similarity-cache.json',
  largeCorpusThreshold: 10000
};

/**
 * Optimized similarity provider using MinHash-LSH
 * Implements the SimilarityProvider interface with the optimized MinHash implementation
 */
export class OptimizedSimilarityProvider implements SimilarityProvider {
  private readonly config: OptimizedSimilarityConfig;
  private readonly vault: Vault;
  private minhash: MinHashLSH;

  // Track file access times for prioritization
  private readonly fileAccessTimes = new Map<string, number>();

  // Whether initialization is complete
  private isInitialized = false;

  // Whether the corpus is sampled (limited to maxFiles)
  private _isCorpusSampled = false;

  // Map from file path to common terms (for display)
  private readonly commonTermsCache = new Map<string, Map<string, string[]>>();

  constructor(vault: Vault, config: Partial<OptimizedSimilarityConfig> = {}) {
    this.vault = vault;
    this.config = { ...DEFAULT_OPTIMIZED_SIMILARITY_CONFIG, ...config };

    // Create the MinHash-LSH instance
    this.minhash = new MinHashLSH(vault, this.config.minhash);
  }

  /**
   * Initialize the similarity provider
   * @param onProgress Optional callback for progress reporting
   */
  public async initialize(onProgress?: (processed: number, total: number) => void): Promise<void> {
    try {
      // Get all markdown files
      const allFiles = this.vault.getMarkdownFiles();

      // Determine if corpus is large
      this._isCorpusSampled = allFiles.length > this.config.largeCorpusThreshold;

      // Initialize MinHash-LSH
      await this.minhash.initialize((processed, total) => {
        if (onProgress) {
          // Map progress to 0-100 range
          const percentage = Math.floor((processed / total) * 100);
          onProgress(percentage, 100);
        }
      });

      // Mark as initialized
      this.isInitialized = true;
    } catch (error) {
      console.error('Error initializing similarity provider:', error);
      throw error;
    }
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
   * Get candidate files for a given file
   * These are files that are likely to be related
   * @param file The file to find candidates for
   * @returns Array of candidate TFile objects
   */
  public getCandidateFiles(file: TFile): TFile[] {
    // Update access time for this file
    this.updateFileAccessTime(file);

    // Use the MinHash-LSH to find similar documents
    return this.minhash.findSimilarDocuments(file);
  }

  /**
   * Extract common terms from two documents
   * @param file1 First file
   * @param file2 Second file
   * @returns Array of common terms
   */
  private async extractCommonTerms(file1: TFile, file2: TFile): Promise<string[]> {
    // Check the cache first
    const cacheKey1 = `${file1.path}::${file2.path}`;
    const cacheKey2 = `${file2.path}::${file1.path}`;

    const cache1 = this.commonTermsCache.get(file1.path);
    if (cache1 && cache1.has(file2.path)) {
      return cache1.get(file2.path)!;
    }

    const cache2 = this.commonTermsCache.get(file2.path);
    if (cache2 && cache2.has(file1.path)) {
      return cache2.get(file1.path)!;
    }

    try {
      // Read the file contents
      const [content1, content2] = await Promise.all([
        this.vault.cachedRead(file1),
        this.vault.cachedRead(file2)
      ]);

      const tokens1 = content1.split(/\s+/);
      const tokens2 = content2.split(/\s+/);

      // Find common terms (using a frequency-based approach)
      const freq1 = new Map<string, number>();
      const freq2 = new Map<string, number>();

      // Build frequency maps
      for (const token of tokens1) {
        if (token.length > 2) { // Skip very short tokens
          freq1.set(token, (freq1.get(token) || 0) + 1);
        }
      }

      for (const token of tokens2) {
        if (token.length > 2) { // Skip very short tokens
          freq2.set(token, (freq2.get(token) || 0) + 1);
        }
      }

      // Find common terms
      const commonTerms: Array<{ term: string; score: number }> = [];

      for (const [term, count1] of freq1.entries()) {
        const count2 = freq2.get(term) || 0;
        if (count2 > 0) {
          // Score based on both frequencies
          commonTerms.push({
            term,
            score: count1 * count2
          });
        }
      }

      // Sort by score (descending) and take top terms
      const result = commonTerms
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(item => item.term);

      // Cache the result
      if (!this.commonTermsCache.has(file1.path)) {
        this.commonTermsCache.set(file1.path, new Map<string, string[]>());
      }
      this.commonTermsCache.get(file1.path)!.set(file2.path, result);

      return result;
    } catch (error) {
      console.error(`Error extracting common terms between ${file1.path} and ${file2.path}:`, error);
      return [];
    }
  }

  /**
   * Compute cosine similarity between two files
   * This implementation uses the MinHash similarity estimate for efficiency
   * @param file1 First file
   * @param file2 Second file
   * @returns Similarity information
   */
  public async computeCappedCosineSimilarity(
    file1: TFile,
    file2: TFile
  ): Promise<SimilarityInfo> {
    try {
      // Get similarity score from MinHash-LSH
      const similars = this.minhash.findSimilarDocumentsWithScores(
        file1,
        0, // No threshold, we'll handle filtering later
        1000 // Large limit to ensure we find the file we're looking for
      );

      // Find the result for file2
      const result = similars.find(s => s.file2.path === file2.path);

      // If found in LSH, extract common terms and create result
      const similarity = result ? result.estimatedSimilarity : 0;
      const commonTerms = await this.extractCommonTerms(file1, file2);

      return {
        similarity,
        commonTerms
      };
    } catch (error) {
      console.error(`Error computing similarity between ${file1.path} and ${file2.path}:`, error);
      return { similarity: 0, commonTerms: [] };
    }
  }

  // On-demand caching has been removed

  // On-demand computation has been removed

  /**
   * Force a full reindexing of all documents
   * @param onProgress Optional callback for progress reporting
   */
  public async forceReindex(onProgress?: (processed: number, total: number) => void): Promise<void> {
    // Initialize a new MinHash-LSH instance (effectively discard the old one)
    this.minhash.initialize();

    // Clear caches
    this.commonTermsCache.clear();

    // Reinitialize
    this.isInitialized = false;
    await this.initialize(onProgress);
  }

  /**
   * Check if the corpus is sampled (limited to a subset of all files)
   */
  public isCorpusSampled(): boolean {
    return this._isCorpusSampled;
  }

  /**
   * Check if a file is in the LSH index
   * @param file The file to check
   */
  public isFileIndexed(file: TFile): boolean {
    // Get all similar documents to see if the file is indexed
    const similarities = this.minhash.findSimilarDocumentsWithScores(file, 0, 1);

    // If we got any results, the file is indexed
    return similarities.length > 0 || similarities.some(s => s.file1.path === file.path);
  }

  /**
   * Get statistics about the provider
   */
  public getStatistics(): ProviderStatistics {
    const minhashStats = this.minhash.getStats();

    return {
      isInitialized: this.isInitialized,
      isCorpusSampled: this._isCorpusSampled,
      commonTermsCacheSize: this.commonTermsCache.size,
      fileAccessTimesCount: this.fileAccessTimes.size,
      similarityThreshold: this.config.similarityThreshold,
      numDocuments: minhashStats.numDocuments as number,
      numHashes: minhashStats.numHashes as number,
      shingleSize: minhashStats.shingleSize as number,
      useWordShingles: minhashStats.useWordShingles as boolean,
      numBands: minhashStats.numBands as number,
      rowsPerBand: minhashStats.rowsPerBand as number,
      totalBuckets: minhashStats.totalBuckets as number,
      maxBucketSize: minhashStats.maxBucketSize as number,
      avgBucketSize: minhashStats.avgBucketSize as number
    };
  }
}