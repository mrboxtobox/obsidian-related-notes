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
    await this.simhash.initialize(progressCallback);
  }
  
  /**
   * Add a document to the index
   * @param file The file to add
   * @param content Optional content (will be read from vault if not provided)
   */
  public async addDocument(file: TFile, content?: string): Promise<void> {
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
   * Get statistics about the SimHash index
   * @returns Object with statistics
   */
  public getStats(): SimHashStats {
    return this.simhash.getStats();
  }
}

/**
 * Factory for creating the appropriate similarity provider
 * based on configuration and corpus size
 */
export function createSimilarityProvider(vault: Vault, config: any = {}): SimilarityProvider {
  const files = vault.getMarkdownFiles();
  
  // Use SimHash for very large corpora or if specified
  if (config.useSimHash || files.length > 10000) {
    return new SimHashProvider(vault, {
      simhash: {
        hashBits: 64,
        shingleSize: 2,
        useChunkIndex: true
      },
      similarityThreshold: 0.7,
      maxRelatedNotes: 20
    });
  }
  
  // Use MinHash-LSH for medium to large corpora
  if (files.length > 1000) {
    // Import dynamically to avoid circular dependencies
    const { MinHashLSH } = require('./minhash');
    return new MinHashLSH(vault, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });
  }
  
  // Default to MinHash with fewer hashes for smaller corpora
  const { MinHashLSH } = require('./minhash');
  return new MinHashLSH(vault, {
    numHashes: 64,
    numBands: 16,
    rowsPerBand: 4,
    shingleSize: 2,
    useWordShingles: true
  });
}