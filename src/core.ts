/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
* Includes smart caching to improve performance and reduce token usage.
*/

import { Vault, TFile } from 'obsidian';


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
  /**
   * Initialize the similarity provider with all files in the vault
   * @param onProgress Optional callback for progress reporting
   */
  initialize(onProgress?: (processed: number, total: number) => void): Promise<void>;
  
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
   * Update the access time for a file
   * This is used for prioritizing files
   * @param file The file to update
   */
  updateFileAccessTime(file: TFile): void;
  
  /**
   * Check if the corpus is sampled (limited to a subset of all files)
   */
  isCorpusSampled(): boolean;
  
  /**
   * Force a full reindexing of all documents
   * @param onProgress Optional callback for progress reporting
   */
  forceReindex(onProgress?: (processed: number, total: number) => void): Promise<void>;
  
  /**
   * Get statistics about the provider
   * @returns Object with statistics
   */
  getStatistics(): ProviderStatistics;
  
  /**
   * Add a document to the index
   * @param file The file to add
   * @param content Optional content (will be read from vault if not provided)
   */
  addDocument?(file: TFile, content?: string): Promise<void>;
  
  /**
   * Remove a document from the index
   * @param filePath Path of the file to remove
   */
  removeDocument?(filePath: string): void;
  
  /**
   * Update a document in the index
   * @param file The file to update
   * @param content Optional content (will be read from vault if not provided)
   */
  updateDocument?(file: TFile, content?: string): Promise<void>;
  
  /**
   * Check if a file is already indexed
   * @param file The file to check
   * @returns True if the file is already indexed, false otherwise
   */
  isFileIndexed?(file: TFile): boolean;
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
  onDemandIndexedCount?: number;
  totalIndexedCount?: number;
}

// No more OptimizedSimilarityConfig needed - we're using SimHash now