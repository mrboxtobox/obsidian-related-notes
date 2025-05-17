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
  initialize(onProgress?: (processed: number, total: number) => void): Promise<void>;
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
  updateFileAccessTime(file: TFile): void;
  isCorpusSampled(): boolean;
  forceReindex(onProgress?: (processed: number, total: number) => void): Promise<void>
  getStatistics(): ProviderStatistics;
  addDocument?(file: TFile, content?: string): Promise<void>;

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