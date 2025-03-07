/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
* Includes smart caching to improve performance and reduce token usage.
*/

import { Vault, TFile, normalizePath } from 'obsidian';

'use strict';

const FREQUENCY_CAP = 10;
const CACHE_VERSION = 1;

export interface RelatedNote {
  file: TFile;
  similarity: number;
  commonTerms?: string[]; // Common terms between the notes
  isPreIndexed?: boolean; // Whether this note was pre-indexed or computed on-demand
  computedOnDemand?: boolean; // Legacy field for backward compatibility
}

export interface SimilarityInfo {
  similarity: number;
  commonTerms?: string[]; // Add common terms to the similarity info
}

export interface SimilarityProvider {
  initialize(onProgress?: (processed: number, total: number) => void): Promise<void>;
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
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
 * Enhanced tokenization function that processes text into meaningful terms
 * Handles contractions, possessives, stop words, and special characters
 * Preserves technical terms, code identifiers, and domain-specific vocabulary
 */
export function tokenize(text: string): string {
  if (!text) return '';

  // Expanded stop words list
  const stopWords = new Set([
    // Articles
    'a', 'an', 'the',
    // Prepositions
    'in', 'on', 'at', 'with', 'by', 'from', 'to', 'for', 'of', 'about', 'as',
    'into', 'over', 'under', 'above', 'below', 'between', 'among', 'through',
    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet', 'after', 'although', 'because',
    // Common verbs
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might', 'must',
    // Pronouns
    'i', 'me', 'my', 'mine', 'myself',
    'you', 'your', 'yours', 'yourself',
    'he', 'him', 'his', 'himself',
    'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself',
    'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'this', 'that', 'these', 'those',
    // Other common words
    'what', 'which', 'who', 'whom', 'whose',
    'when', 'where', 'why', 'how',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
    'no', 'not', 'only', 'than', 'too', 'very'
  ]);

  // More comprehensive contractions handling
  const contractions = new Map([
    // Negations
    ["n't", " not"],
    // Verb forms
    ["'re", " are"], ["'m", " am"], ["'s", " is"], ["'ve", " have"],
    ["'d", " would"], ["'ll", " will"],
    // Special cases
    ["'clock", " oclock"], ["o'clock", "oclock"],
    ["'cause", " because"], ["'n'", " and "],
    // Possessives - preserve the base word
    ["s'", "s"], ["s's", "s"]
  ]);

  try {
    // Step 1: Preserve code identifiers and technical terms
    // Replace code blocks with placeholders
    const codeBlocks: string[] = [];
    let codeBlockCounter = 0;

    // Replace inline code and code blocks with placeholders
    let processed = text.replace(/`([^`]+)`|```[\s\S]+?```/g, (match) => {
      const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
      codeBlocks.push(match);
      codeBlockCounter++;
      return placeholder;
    });

    // Step 2: Handle URLs and file paths - preserve them
    const urls: string[] = [];
    let urlCounter = 0;
    processed = processed.replace(/https?:\/\/[^\s]+|file:\/\/[^\s]+|[\w\/\.-]+\.(md|txt|js|ts|html|css|json|py|java|rb|c|cpp|h|go|rs|php)/g, (match) => {
      const placeholder = `__URL_${urlCounter}__`;
      urls.push(match);
      urlCounter++;
      return placeholder;
    });

    // Step 3: Handle contractions
    processed = processed.replace(
      new RegExp(Object.keys(contractions).join('|'), 'g'),
      match => contractions.get(match) || match
    );

    // Step 4: Handle special characters and convert to lowercase
    processed = processed.toLowerCase()
      // Keep hyphens and underscores for compound words and code identifiers
      .replace(/[^\w\s\-_]/g, ' ')
      // Convert multiple spaces to single space
      .replace(/\s+/g, ' ');

    // Step 5: Split into words, filter stop words and short terms
    let tokens = processed.split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Step 6: Restore code blocks and URLs
    tokens = tokens.map(token => {
      if (token.startsWith('__CODE_BLOCK_')) {
        const index = parseInt(token.replace('__CODE_BLOCK_', '').replace('__', ''));
        return codeBlocks[index].replace(/`|```/g, '').trim();
      }
      if (token.startsWith('__URL_')) {
        const index = parseInt(token.replace('__URL_', '').replace('__', ''));
        return urls[index];
      }
      return token;
    });

    // Step 7: Simple stemming for common suffixes
    tokens = tokens.map(word => {
      // Skip URLs, code blocks, and technical terms
      if (word.includes('/') || word.includes('.') ||
        word.includes('_') || word.includes('-')) {
        return word;
      }

      // Simple stemming rules
      if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
      if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
      if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
      if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y';
      if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
      return word;
    });

    return tokens.join(' ');
  } catch (error) {
    console.error('Error during tokenization:', error);
    return '';
  }
}

export class SimilarityProviderV2 implements SimilarityProvider {
  /**
   * Yields to the main thread to prevent UI blocking during intensive operations
   * @param count Current iteration count
   * @param batchSize Number of operations to perform before yielding
   * @param forceYield When true, always yield regardless of count/batchSize
   * @returns Promise that resolves after yielding
   */
  private async yieldToMain(count: number, batchSize: number, forceYield: boolean = false): Promise<void> {
    // Yield if we've hit the batch size or if yielding is forced
    if (forceYield || count % batchSize === 0) {
      // Use requestAnimationFrame if available (better for UI responsiveness)
      // Fallback to setTimeout with 0ms delay
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
  }

  /**
   * Gets the size of the vocabulary
   */
  public getVocabularySize(): number {
    return this.vocabulary.length;
  }

  /**
   * Gets the number of file vectors
   */
  public getFileVectorsCount(): number {
    return this.fileVectors.size;
  }

  /**
   * Gets the number of signatures
   */
  public getSignaturesCount(): number {
    return this.signatures.size;
  }

  /**
   * Gets the number of related notes entries
   */
  public getRelatedNotesCount(): number {
    return this.relatedNotes.size;
  }

  /**
   * Gets the number of on-demand cache entries
   */
  public getOnDemandCacheCount(): number {
    return this.onDemandCache.size;
  }

  /**
   * Gets the average shingle size
   */
  public getAverageShingleSize(): number {
    if (this.fileVectors.size === 0) return 0;

    let totalSize = 0;
    let count = 0;

    for (const shingles of this.fileVectors.values()) {
      totalSize += shingles.size;
      count++;
    }

    return totalSize / count;
  }

  /**
   * Gets the average document length
   */
  public getAverageDocLength(): number {
    return this.getAverageShingleSize() * this.config.shingleSize;
  }

  /**
   * Gets the number of LSH bands
   */
  public getLSHBands(): number {
    return this.isCorpusSampled() ? this.config.largeBands : this.config.numBands;
  }

  /**
   * Gets the number of rows per LSH band
   */
  public getLSHRowsPerBand(): number {
    return this.isCorpusSampled() ? this.config.largeRowsPerBand : this.config.rowsPerBand;
  }

  /**
   * Gets the average similarity score
   */
  public getAverageSimilarityScore(): number {
    if (this.relatedNotes.size === 0) return 0;

    // This is an approximation since we don't store the actual similarity scores
    // in the relatedNotes map. We'll use a fixed value based on the threshold.
    return this.isCorpusSampled() ?
      this.config.minSimilarityThreshold * 1.5 :
      this.similarityThreshold * 1.5;
  }

  /**
   * Gets the number of on-demand computations performed
   */
  public getOnDemandComputationsCount(): number {
    // This is an approximation since we don't track the actual count
    let total = 0;
    for (const cache of this.onDemandCache.values()) {
      total += cache.size;
    }
    return total;
  }

  /**
   * Forces a complete re-indexing of all notes
   * This is useful when the user wants to ensure the index is up-to-date
   * @param onProgress Optional callback for progress reporting
   */
  public async forceReindex(onProgress?: (processed: number, total: number) => void): Promise<void> {
    // Clear existing data
    this.vocabulary.length = 0;
    this.fileVectors.clear();
    this.signatures.clear();
    this.relatedNotes.clear();
    this.fileMetadata.clear();
    this.onDemandCache.clear();
    this.fileAccessTimes.clear(); // Clear file access times to reset priority

    // Set cache as dirty to ensure it's saved after reindexing
    this.cacheDirty = true;

    // Perform full initialization with more frequent yielding to main thread
    await this.buildVocabularyAndVectors((processed, total) => {
      // More frequent yielding to main thread during this CPU-intensive operation
      if (processed % Math.max(1, Math.floor(total / 100)) === 0) {
        this.yieldToMain(0, 1, true); // Force yield to main thread
      }
      onProgress?.(Math.floor(processed / total * 25), 100);
    });

    await this.generateHashFunctions((processed, total) => {
      // Yield to main thread more frequently
      if (processed % Math.max(1, Math.floor(total / 50)) === 0) {
        this.yieldToMain(0, 1, true); // Force yield to main thread
      }
      onProgress?.(25 + Math.floor(processed / total * 25), 100);
    });

    await this.createSignatures((processed, total) => {
      // Yield to main thread more frequently
      if (processed % Math.max(1, Math.floor(total / 50)) === 0) {
        this.yieldToMain(0, 1, true); // Force yield to main thread
      }
      onProgress?.(50 + Math.floor(processed / total * 25), 100);
    });

    await this.processCandidatePairs((processed, total) => {
      // Yield to main thread more frequently
      if (processed % Math.max(1, Math.floor(total / 50)) === 0) {
        this.yieldToMain(0, 1, true); // Force yield to main thread
      }
      onProgress?.(75 + Math.floor(processed / total * 25), 100);
    });

    // Save to cache
    await this.saveToCache();
  }

  private readonly vocabulary: string[] = [];
  private readonly fileVectors = new Map<string, Set<string>>();
  private readonly signatures = new Map<string, number[]>();
  private readonly minhashFunctions: number[][] = [];
  private readonly relatedNotes = new Map<string, TFile[]>();
  // name.md -> TFile[]
  private readonly nameToTFile = new Map<string, TFile>();
  private readonly fileMetadata = new Map<string, { mtime: number; size: number }>();
  private isCorpusTruncated = false;
  private cacheDirty = false;
  private lastCacheUpdate = 0;
  private readonly cacheUpdateInterval = 5 * 60 * 1000; // 5 minutes
  private readonly driftThreshold = 0.1; // 10% drift allowed
  private readonly similarityThreshold = 0.3; // Default similarity threshold

  // Track file access and creation times
  private readonly fileAccessTimes = new Map<string, number>();
  private readonly onDemandCache = new Map<string, Map<string, SimilarityInfo>>();
  private readonly priorityIndexSize: number;
  private readonly onDemandCacheSize: number;
  public readonly onDemandComputationEnabled: boolean;
  private readonly disableIncrementalUpdates: boolean;

  constructor(
    private readonly vault: Vault,
    private readonly config = {
      numBands: 5,
      rowsPerBand: 2,
      shingleSize: 2,
      batchSize: 1,
      priorityIndexSize: 10000, // Number of files to pre-index (increased from 5000)
      cacheFilePath: 'similarity-cache.json', // Will be prefixed with manifest.dir
      // Adaptive parameters for large corpora
      largeBands: 8,       // More bands for large corpora = more candidates
      largeRowsPerBand: 1, // Fewer rows per band = more lenient matching
      largeCorpusThreshold: 1000, // When to consider a corpus "large"
      minSimilarityThreshold: 0.15, // Lower threshold for large corpora
      onDemandCacheSize: 1000, // Number of on-demand computations to cache
      onDemandComputationEnabled: true, // Enable on-demand computation
      disableIncrementalUpdates: false // When true, only reindex on application restart
    }
  ) {
    // Dynamically adjust LSH parameters based on corpus size
    const signatureSize = config.numBands * config.rowsPerBand;
    if (signatureSize % config.numBands !== 0) {
      throw new Error('Signature size must be divisible by number of bands');
    }

    // Initialize priority index size and on-demand cache size
    this.priorityIndexSize = config.priorityIndexSize;
    this.onDemandCacheSize = config.onDemandCacheSize;
    this.onDemandComputationEnabled = config.onDemandComputationEnabled;
    this.disableIncrementalUpdates = config.disableIncrementalUpdates;
  }

  getCandidateFiles(file: TFile): TFile[] {
    // Update access time for this file
    this.fileAccessTimes.set(file.name, Date.now());

    // Get pre-indexed candidates
    const preIndexedCandidates = this.relatedNotes.get(file.name) || [];

    // If on-demand computation is disabled, return only pre-indexed candidates
    if (!this.onDemandComputationEnabled) {
      return preIndexedCandidates;
    }

    // For files that aren't in the priority index, we'll need to compute candidates on-the-fly
    // This is handled in the main plugin's getRelatedNotes method
    return preIndexedCandidates;
  }

  /**
   * Checks if a file is in the priority index
   */
  isFileIndexed(file: TFile): boolean {
    return this.fileVectors.has(file.name);
  }

  /**
   * Updates the access time for a file
   */
  updateFileAccessTime(file: TFile): void {
    this.fileAccessTimes.set(file.name, Date.now());
  }

  isCorpusSampled(): boolean {
    return this.isCorpusTruncated;
  }

  private shuffleArray<T>(array: T[]): void {
    if (!array) return;

    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async initialize(onProgress?: (processed: number, total: number) => void): Promise<void> {
    // Helper function to report progress with smoother increments
    const reportProgress = (phase: number, phaseProgress: number) => {
      if (!onProgress) return;

      // Each phase is 25% of the total progress
      // Calculate the overall progress based on the current phase and progress within that phase
      const basePercentage = phase * 25;
      const phaseContribution = phaseProgress * 25;

      // Report progress in 1% increments for smoother updates
      const smoothedPercentage = Math.floor(basePercentage + phaseContribution);
      onProgress(smoothedPercentage, 100);
    };

    // Try to load from cache first
    const cacheLoaded = await this.loadFromCache();

    if (cacheLoaded) {
      // Report initial progress after cache load
      for (let i = 1; i <= 25; i += 1) {
        reportProgress(0, i / 25);
        await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for visual effect
      }

      // Check for changes since last cache update
      const changedFiles = await this.identifyChangedFiles();
      const totalFiles = this.vault.getMarkdownFiles().length;
      const changedPercentage = changedFiles.length / totalFiles;

      // Skip incremental updates if disabled or if no changes/within drift threshold
      if (this.disableIncrementalUpdates ||
        changedFiles.length === 0 ||
        (changedPercentage < this.driftThreshold && Date.now() - this.lastCacheUpdate < this.cacheUpdateInterval)) {
        // No changes or within drift threshold and update interval - use cache as is
        // Smoothly progress from 25% to 100%
        for (let i = 26; i <= 100; i += 1) {
          onProgress?.(i, 100);
          await new Promise(resolve => setTimeout(resolve, 10)); // Small delay for visual effect
        }
        return;
      }

      // Incremental update for changed files with smoother progress reporting
      await this.incrementalUpdate(changedFiles, (processed, total) => {
        // Map the incremental update progress (25-100%) to smoother increments
        const incrementalProgress = processed / total;
        const overallProgress = 25 + (incrementalProgress * 75);
        onProgress?.(Math.floor(overallProgress), 100);
      });
    } else {
      // Full initialization if cache not available
      // Phase 1: Reading documents (0-25%)
      await this.buildVocabularyAndVectors((processed, total) => {
        reportProgress(0, processed / total);
      });

      // Phase 2: Analyzing patterns (25-50%)
      await this.generateHashFunctions((processed, total) => {
        reportProgress(1, processed / total);
      });

      // Phase 3: Finding connections (50-75%)
      await this.createSignatures((processed, total) => {
        reportProgress(2, processed / total);
      });

      // Phase 4: Building relationships (75-100%)
      await this.processCandidatePairs((processed, total) => {
        reportProgress(3, processed / total);
      });

      // Save to cache
      this.cacheDirty = true;
      await this.saveToCache();
    }
  }

  private async loadFromCache(): Promise<boolean> {
    try {
      const cacheFilePath = normalizePath(this.config.cacheFilePath);
      if (await this.vault.adapter.exists(cacheFilePath)) {
        const cacheContent = await this.vault.adapter.read(cacheFilePath);
        const cacheData = JSON.parse(cacheContent) as CacheData;

        // Verify cache version
        if (cacheData.version !== CACHE_VERSION) {
          console.log('Cache version mismatch, rebuilding cache');
          return false;
        }

        // Load data from cache
        this.lastCacheUpdate = cacheData.lastUpdated;

        // Restore file vectors
        for (const [fileName, shingles] of Object.entries(cacheData.fileVectors)) {
          this.fileVectors.set(fileName, new Set(shingles));
          // Add to vocabulary
          shingles.forEach(shingle => this.vocabulary.push(shingle));
        }

        // Restore signatures
        for (const [fileName, signature] of Object.entries(cacheData.signatures)) {
          this.signatures.set(fileName, signature);
        }

        // Restore file metadata
        for (const [fileName, metadata] of Object.entries(cacheData.fileMetadata)) {
          this.fileMetadata.set(fileName, metadata);
        }

        // Restore related notes (need to convert paths back to TFile objects)
        const allFiles = this.vault.getMarkdownFiles();
        for (const file of allFiles) {
          this.nameToTFile.set(file.name, file);
        }

        for (const [fileName, relatedFileNames] of Object.entries(cacheData.relatedNotes)) {
          const relatedTFiles = relatedFileNames
            .map(name => this.nameToTFile.get(name))
            .filter((file): file is TFile => file !== undefined);

          this.relatedNotes.set(fileName, relatedTFiles);
        }

        // Generate hash functions if needed
        if (this.minhashFunctions.length === 0) {
          const signatureSize = this.config.numBands * this.config.rowsPerBand;
          for (let i = 0; i < signatureSize; i++) {
            const hashFunc = Array.from(
              { length: this.vocabulary.length },
              (_, i) => i + 1
            );
            this.shuffleArray(hashFunc);
            this.minhashFunctions.push(hashFunc);
          }
        }

        console.log('Cache loaded successfully');
        return true;
      }
    } catch (error) {
      console.error('Error loading cache:', error);
    }

    return false;
  }

  private async saveToCache(): Promise<void> {
    if (!this.cacheDirty) return;

    try {
      const cacheFilePath = normalizePath(this.config.cacheFilePath);

      // Convert maps to serializable objects
      const fileVectorsObj: Record<string, string[]> = {};
      for (const [fileName, shingles] of this.fileVectors.entries()) {
        fileVectorsObj[fileName] = Array.from(shingles);
      }

      const signaturesObj: Record<string, number[]> = {};
      for (const [fileName, signature] of this.signatures.entries()) {
        signaturesObj[fileName] = signature;
      }

      const relatedNotesObj: Record<string, string[]> = {};
      for (const [fileName, tfiles] of this.relatedNotes.entries()) {
        relatedNotesObj[fileName] = tfiles.map(file => file.name);
      }

      const fileMetadataObj: Record<string, { mtime: number; size: number }> = {};
      for (const [fileName, metadata] of this.fileMetadata.entries()) {
        fileMetadataObj[fileName] = metadata;
      }

      const cacheData: CacheData = {
        version: CACHE_VERSION,
        lastUpdated: Date.now(),
        fileVectors: fileVectorsObj,
        signatures: signaturesObj,
        relatedNotes: relatedNotesObj,
        fileMetadata: fileMetadataObj
      };

      await this.vault.adapter.write(cacheFilePath, JSON.stringify(cacheData));
      this.lastCacheUpdate = cacheData.lastUpdated;
      this.cacheDirty = false;
      console.log('Cache saved successfully');
    } catch (error) {
      console.error('Error saving cache:', error);
    }
  }

  private async identifyChangedFiles(): Promise<TFile[]> {
    const allFiles = this.vault.getMarkdownFiles();
    const changedFiles: TFile[] = [];

    for (const file of allFiles) {
      const currentMetadata = {
        mtime: file.stat.mtime,
        size: file.stat.size
      };

      const cachedMetadata = this.fileMetadata.get(file.name);

      // File is new or modified
      if (!cachedMetadata ||
        cachedMetadata.mtime !== currentMetadata.mtime ||
        cachedMetadata.size !== currentMetadata.size) {
        changedFiles.push(file);
      }
    }

    // Check for deleted files
    const currentFileNames = new Set(allFiles.map(file => file.name));
    const cachedFileNames = Array.from(this.fileMetadata.keys());

    for (const fileName of cachedFileNames) {
      if (!currentFileNames.has(fileName)) {
        // File was deleted, remove from cache
        this.fileVectors.delete(fileName);
        this.signatures.delete(fileName);
        this.relatedNotes.delete(fileName);
        this.fileMetadata.delete(fileName);
        this.cacheDirty = true;
      }
    }

    return changedFiles;
  }

  private async incrementalUpdate(changedFiles: TFile[], onProgress?: (processed: number, total: number) => void): Promise<void> {
    if (changedFiles.length === 0) return;

    let processedCount = 0;
    const totalFiles = changedFiles.length;

    // Update file vectors and signatures for changed files
    for (const file of changedFiles) {
      try {
        const content = await this.vault.cachedRead(file);
        const processed = tokenize(content);
        const shingles = this.buildShingles(processed);

        // Update vocabulary with new shingles
        shingles.forEach(shingle => {
          if (!this.vocabulary.includes(shingle)) {
            this.vocabulary.push(shingle);
          }
        });

        // Update file vectors
        this.fileVectors.set(file.name, shingles);

        // Update file metadata
        this.fileMetadata.set(file.name, {
          mtime: file.stat.mtime,
          size: file.stat.size
        });

        // Update name to TFile mapping
        this.nameToTFile.set(file.name, file);

        // Create signature for the file
        const signature = await this.createSignature(shingles);
        this.signatures.set(file.name, signature);

        processedCount++;
        if (onProgress) {
          const percentage = 25 + Math.floor((processedCount / totalFiles) * 50);
          onProgress(percentage, 100);
        }

        await this.yieldToMain(processedCount, this.config.batchSize);
      } catch (error) {
        console.warn(`Error processing ${file.name}:`, error);
      }
    }

    // Update related notes for changed files
    await this.updateRelatedNotes(changedFiles, onProgress);

    // Mark cache as dirty
    this.cacheDirty = true;
    await this.saveToCache();
  }

  private async updateRelatedNotes(changedFiles: TFile[], onProgress?: (processed: number, total: number) => void): Promise<void> {
    const changedFileNames = new Set(changedFiles.map(file => file.name));
    let processedCount = 0;

    // For each changed file, find related notes
    for (const file of changedFiles) {
      // Find candidate pairs for this file
      const candidatePairs = this.findCandidatePairsForFile(file.name);

      // Update related notes for this file
      const relatedTFiles: TFile[] = [];
      for (const relatedFileName of candidatePairs) {
        const tfile = this.nameToTFile.get(relatedFileName);
        if (tfile) {
          relatedTFiles.push(tfile);

          // Also update the related file's related notes if it's not in the changed files list
          if (!changedFileNames.has(relatedFileName)) {
            const existingRelated = this.relatedNotes.get(relatedFileName) || [];
            if (!existingRelated.some(f => f.name === file.name)) {
              existingRelated.push(file);
              this.relatedNotes.set(relatedFileName, existingRelated);
            }
          }
        }
      }

      this.relatedNotes.set(file.name, relatedTFiles);

      processedCount++;
      if (onProgress) {
        const percentage = 75 + Math.floor((processedCount / changedFiles.length) * 25);
        onProgress(percentage, 100);
      }

      await this.yieldToMain(processedCount, this.config.batchSize);
    }
  }

  private findCandidatePairsForFile(fileName: string): string[] {
    const candidates = new Set<string>();
    const signature = this.signatures.get(fileName);
    if (!signature) return [];

    const bands = this.splitSignature(signature);

    // For each band, find files that hash to the same bucket
    bands.forEach((band, bandIdx) => {
      const bucketKey = `${bandIdx}-${this.hashBand(band)}`;

      // Find all files that hash to the same bucket
      for (const [otherFileName, otherSignature] of this.signatures.entries()) {
        if (otherFileName === fileName) continue;

        const otherBands = this.splitSignature(otherSignature);
        // Skip if this band doesn't exist in the other signature
        if (!otherBands[bandIdx]) continue;

        const otherBucketKey = `${bandIdx}-${this.hashBand(otherBands[bandIdx])}`;

        if (bucketKey === otherBucketKey) {
          candidates.add(otherFileName);
        }
      }
    });

    return Array.from(candidates);
  }

  /**
   * Prioritizes files for indexing based on access time and creation time
   */
  private prioritizeFiles(files: TFile[]): TFile[] {
    // Create a copy of the files array to avoid modifying the original
    const filesCopy = [...files];

    // Sort files by access time (most recently accessed first)
    filesCopy.sort((a, b) => {
      const accessTimeA = this.fileAccessTimes.get(a.name) || 0;
      const accessTimeB = this.fileAccessTimes.get(b.name) || 0;

      // If access times are the same, sort by creation time (most recent first)
      if (accessTimeA === accessTimeB) {
        return b.stat.ctime - a.stat.ctime;
      }

      return accessTimeB - accessTimeA;
    });

    return filesCopy;
  }

  private async buildVocabularyAndVectors(onProgress?: (processed: number, total: number) => void): Promise<void> {
    const allFiles = this.vault.getMarkdownFiles();
    for (const file of allFiles) {
      this.nameToTFile.set(file.name, file);

      // Initialize access times based on file stats
      // Use mtime (modification time) as a proxy for access time initially
      if (!this.fileAccessTimes.has(file.name)) {
        this.fileAccessTimes.set(file.name, file.stat.mtime);
      }
    }

    // Prioritize files for indexing
    const prioritizedFiles = this.prioritizeFiles(allFiles);

    let processedCount = 0;
    const filesToProcess = prioritizedFiles.slice(0, this.priorityIndexSize);
    const totalFiles = filesToProcess.length;
    this.isCorpusTruncated = allFiles.length > this.priorityIndexSize;

    for (const file of filesToProcess) {
      try {
        const content = await this.vault.cachedRead(file);
        const processed = tokenize(content);
        const shingles = this.buildShingles(processed);

        shingles.forEach(shingle => this.vocabulary.push(shingle));
        this.fileVectors.set(file.name, shingles);

        // Store file metadata for change detection
        this.fileMetadata.set(file.name, {
          mtime: file.stat.mtime,
          size: file.stat.size
        });

        processedCount++;
        onProgress?.(processedCount, totalFiles);
        await this.yieldToMain(processedCount, this.config.batchSize);
      } catch (error) {
        console.warn(`Error processing ${file.name}:`, error);
      }
    }
  }

  private async generateHashFunctions(onProgress?: (processed: number, total: number) => void): Promise<void> {
    const signatureSize = this.config.numBands * this.config.rowsPerBand;
    for (let i = 0; i < signatureSize; i++) {
      const hashFunc = Array.from(
        { length: this.vocabulary.length },
        (_, i) => i + 1
      );
      this.shuffleArray(hashFunc);
      this.minhashFunctions.push(hashFunc);

      onProgress?.(i + 1, signatureSize);
      await this.yieldToMain(i + 1, this.config.batchSize);
    }
  }

  private async createSignatures(onProgress?: (processed: number, total: number) => void): Promise<void> {
    let count = 0;
    const totalFiles = this.fileVectors.size;

    for (const [fileName, shingles] of this.fileVectors) {
      const signature = await this.createSignature(shingles);
      this.signatures.set(fileName, signature);

      count++;
      onProgress?.(count, totalFiles);
      await this.yieldToMain(count, this.config.batchSize);
    }
  }

  private async createSignature(shingles: Set<string>): Promise<number[]> {
    const signature: number[] = [];

    let count = 0;
    for (const hashFunc of this.minhashFunctions) {
      for (let i = 1; i <= this.vocabulary.length; i++) {
        const idx = hashFunc.indexOf(i);
        const shingle = this.vocabulary[idx];
        if (shingles.has(shingle)) {
          signature.push(idx);
          break;
        }
      }
      count++;
      await this.yieldToMain(count, this.config.batchSize);
    }
    return signature;
  }

  private async processCandidatePairs(onProgress?: (processed: number, total: number) => void): Promise<void> {
    const candidatePairs = this.findCandidatePairs();
    let count = 0;
    const total = candidatePairs.length;

    for (const [file1, file2] of candidatePairs) {
      if (!this.nameToTFile.has(file1) || !this.nameToTFile.has(file2)) {
        console.error("File not found:", [file1, file2].find(f => !this.nameToTFile.has(f)));
        continue;
      }

      const tfile1 = this.nameToTFile.get(file1)!;
      const tfile2 = this.nameToTFile.get(file2)!;

      this.relatedNotes
        .set(file1, [...(this.relatedNotes.get(file1) || []), tfile2])
        .set(file2, [...(this.relatedNotes.get(file2) || []), tfile1]);

      count++;
      onProgress?.(count, total);
      await this.yieldToMain(count, this.config.batchSize);
    }
  }

  private findCandidatePairs(): [string, string][] {
    const candidatePairs = new Set<string>();
    const bandBuckets = new Map<string, string[]>();

    // Determine if we're dealing with a large corpus
    const isLargeCorpus = this.fileVectors.size >= this.config.largeCorpusThreshold;

    // Use adaptive LSH parameters based on corpus size
    const numBands = isLargeCorpus ? this.config.largeBands : this.config.numBands;
    const rowsPerBand = isLargeCorpus ? this.config.largeRowsPerBand : this.config.rowsPerBand;

    this.signatures.forEach((signature, fileName) => {
      // Adapt signature splitting based on corpus size
      const bands = this.splitSignatureAdaptive(signature, numBands, rowsPerBand);

      bands.forEach((band, bandIdx) => {
        const bucketKey = `${bandIdx}-${this.hashBand(band)}`;
        const bucket = bandBuckets.get(bucketKey) || [];
        bucket.push(fileName);
        bandBuckets.set(bucketKey, bucket);
      });
    });

    bandBuckets.forEach(fileNames => {
      if (fileNames.length > 1) {
        for (let i = 0; i < fileNames.length - 1; i++) {
          for (let j = i + 1; j < fileNames.length; j++) {
            const pair = [fileNames[i], fileNames[j]].sort();
            candidatePairs.add(pair.join('||'));
          }
        }
      }
    });
    return Array.from(candidatePairs).map(pair => pair.split('||') as [string, string]);
  }

  // Adaptive signature splitting based on corpus size
  private splitSignatureAdaptive(signature: number[], numBands: number, rowsPerBand: number): number[][] {
    const bands: number[][] = [];
    const signatureSize = Math.min(signature.length, numBands * rowsPerBand);

    for (let i = 0; i < signatureSize; i += rowsPerBand) {
      bands.push(signature.slice(i, i + rowsPerBand));
    }

    return bands;
  }

  private splitSignature(signature: number[]): number[][] {
    return this.splitSignatureAdaptive(signature, this.config.numBands, this.config.rowsPerBand);
  }

  private hashBand(band: number[]): string {
    return band.join(',');
  }

  private buildShingles(text: string): Set<string> {
    const shingles = new Set<string>();
    for (let i = 0; i <= text.length - this.config.shingleSize; i++) {
      shingles.add(text.slice(i, i + this.config.shingleSize));
    }
    return shingles;
  }

  /**
   * Computes similarity between two files, with caching for on-demand computations
   */
  async computeCappedCosineSimilarity(
    file1: TFile,
    file2: TFile
  ): Promise<SimilarityInfo> {
    // Check if we have a cached result for this file pair
    const cacheKey1 = `${file1.name}:${file2.name}`;
    const cacheKey2 = `${file2.name}:${file1.name}`;

    // Check on-demand cache first
    const file1Cache = this.onDemandCache.get(file1.name);
    if (file1Cache && file1Cache.has(file2.name)) {
      return file1Cache.get(file2.name)!;
    }

    const file2Cache = this.onDemandCache.get(file2.name);
    if (file2Cache && file2Cache.has(file1.name)) {
      return file2Cache.get(file1.name)!;
    }

    // Determine if we're dealing with a large corpus
    const isLargeCorpus = this.fileVectors.size >= this.config.largeCorpusThreshold;

    // Adjust similarity threshold based on corpus size
    const effectiveThreshold = isLargeCorpus
      ? this.config.minSimilarityThreshold
      : this.similarityThreshold;

    try {
      // Always read the file contents to extract common words
      const [content1, content2] = await Promise.all([
        this.vault.cachedRead(file1),
        this.vault.cachedRead(file2)
      ]);

      // Tokenize the content to get actual words
      const tokens1 = tokenize(content1).split(' ');
      const tokens2 = tokenize(content2).split(' ');

      // Build frequency maps for the tokens
      const freqMap1 = this.buildFrequencyMap(tokens1);
      const freqMap2 = this.buildFrequencyMap(tokens2);

      // Check if we have cached vectors for both files (for faster similarity calculation)
      const vector1 = this.fileVectors.get(file1.name);
      const vector2 = this.fileVectors.get(file2.name);

      let similarity = 0;

      if (vector1 && vector2) {
        // Use cached vectors for faster similarity computation
        const jaccardResult = this.calculateJaccardSimilarity(vector1, vector2);
        similarity = jaccardResult.similarity;
      } else {
        // Fall back to cosine similarity if vectors aren't cached
        const cosineResult = this.calculateCosineSimilarity(freqMap1, freqMap2);
        similarity = cosineResult.similarity;
      }

      // Apply adaptive threshold for large corpora
      if (isLargeCorpus && similarity > 0) {
        // Boost similarity for large corpora
        similarity = Math.min(1, similarity * 1.2);
      }

      // Extract common terms from the actual words (not shingles)
      const commonTerms = this.extractCommonTerms(freqMap1, freqMap2);

      const result = {
        similarity,
        commonTerms
      };

      // Cache the result for future use
      this.cacheOnDemandComputation(file1.name, file2.name, result);

      return result;
    } catch (error) {
      console.error('Error computing similarity:', error);
      return { similarity: 0, commonTerms: [] };
    }
  }

  /**
   * Caches the result of an on-demand computation
   */
  private cacheOnDemandComputation(
    fileName1: string,
    fileName2: string,
    result: SimilarityInfo
  ): void {
    // Get or create cache for file1
    let file1Cache = this.onDemandCache.get(fileName1);
    if (!file1Cache) {
      file1Cache = new Map<string, SimilarityInfo>();
      this.onDemandCache.set(fileName1, file1Cache);
    }

    // Store the result
    file1Cache.set(fileName2, result);

    // Limit cache size by removing oldest entries if needed
    if (file1Cache.size > this.onDemandCacheSize) {
      const oldestKey = file1Cache.keys().next().value;
      if (oldestKey !== undefined) {
        file1Cache.delete(oldestKey);
      }
    }

    // Limit overall cache size by removing oldest file caches if needed
    if (this.onDemandCache.size > this.onDemandCacheSize) {
      const oldestKey = this.onDemandCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.onDemandCache.delete(oldestKey);
      }
    }
  }

  /**
   * Computes related notes on-the-fly for a file that isn't in the priority index
   * @param file The file to find related notes for
   * @param limit Maximum number of notes to return
   * @param excludeFilePaths Optional set of file paths to exclude from results
   */
  async computeRelatedNotesOnDemand(
    file: TFile,
    limit: number = 10,
    excludeFilePaths: Set<string> = new Set()
  ): Promise<RelatedNote[]> {
    // Update access time for this file
    this.updateFileAccessTime(file);

    // Get all markdown files
    const allFiles = this.vault.getMarkdownFiles();

    // Prioritize files for comparison
    const prioritizedFiles = this.prioritizeFiles(allFiles);

    // Take a sample of files to compare against (for performance)
    // Use files from the priority index first, then add some random files
    const filesToCompare: TFile[] = [];

    // Add files from the priority index first
    for (const candidateFile of prioritizedFiles) {
      // Skip the current file and any excluded files
      if (candidateFile.path === file.path || excludeFilePaths.has(candidateFile.path)) continue;

      if (this.isFileIndexed(candidateFile)) {
        filesToCompare.push(candidateFile);

        // Limit to 100 indexed files for performance
        if (filesToCompare.length >= 100) break;
      }
    }

    // Add some random files that aren't in the priority index
    const nonIndexedFiles = allFiles.filter(f =>
      f.path !== file.path &&
      !this.isFileIndexed(f) &&
      !excludeFilePaths.has(f.path)
    );

    // Shuffle and take a sample
    this.shuffleArray(nonIndexedFiles);
    filesToCompare.push(...nonIndexedFiles.slice(0, 50));

    // Calculate similarities
    const similarityPromises = filesToCompare.map(async (candidateFile) => {
      const similarity = await this.computeCappedCosineSimilarity(file, candidateFile);
      return {
        file: candidateFile,
        similarity: similarity.similarity,
        commonTerms: similarity.commonTerms || [],
        computedOnDemand: true
      };
    });

    const relatedNotes = await Promise.all(similarityPromises);

    // Sort by similarity (highest first)
    const sortedNotes = relatedNotes.sort((a, b) => b.similarity - a.similarity);

    // Apply a minimum similarity threshold
    const minSimilarity = 0.15;
    return sortedNotes
      .filter(note => note.similarity >= minSimilarity)
      .slice(0, limit);
  }

  private extractCommonTerms(
    freqMap1: Map<string, number>,
    freqMap2: Map<string, number>
  ): string[] {
    // Find terms that appear in both documents
    const termScores: { term: string, score: number }[] = [];

    for (const [term, freq1] of freqMap1.entries()) {
      const freq2 = freqMap2.get(term) || 0;
      if (freq2 > 0) {
        // Score is the product of frequencies
        termScores.push({ term, score: freq1 * freq2 });
      }
    }

    // Sort terms by their score (highest first) and take top 10
    const result = termScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.term);

    return result || [];
  }

  private calculateJaccardSimilarity(
    set1: Set<string>,
    set2: Set<string>
  ): SimilarityInfo {
    const set1Array = Array.from(set1);
    const set2Array = Array.from(set2);

    // Calculate intersection size
    const intersection = set1Array.filter(item => set2.has(item));

    // Calculate union size
    const union = new Set([...set1Array, ...set2Array]);

    if (union.size === 0) {
      return { similarity: 0, commonTerms: [] };
    }

    // Extract common terms (up to 10 most significant)
    const commonTerms = intersection.slice(0, 10);

    return {
      similarity: intersection.length / union.size,
      commonTerms: commonTerms || []
    };
  }

  private buildFrequencyMap(tokens: string[]): Map<string, number> {
    const freqMap = new Map<string, number>();
    for (const token of tokens) {
      const currentFreq = freqMap.get(token) || 0;
      if (currentFreq < FREQUENCY_CAP) {
        freqMap.set(token, currentFreq + 1);
      }
    }
    return freqMap;
  }

  private calculateCosineSimilarity(
    freqMap1: Map<string, number>,
    freqMap2: Map<string, number>
  ): SimilarityInfo {
    const uniqueTerms = new Set([...freqMap1.keys(), ...freqMap2.keys()]);
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    // Track common terms and their combined frequency
    const termScores: { term: string, score: number }[] = [];

    for (const term of uniqueTerms) {
      const freq1 = freqMap1.get(term) || 0;
      const freq2 = freqMap2.get(term) || 0;

      dotProduct += freq1 * freq2;
      norm1 += freq1 * freq1;
      norm2 += freq2 * freq2;

      // If term appears in both documents, add to common terms
      if (freq1 > 0 && freq2 > 0) {
        // Score is the product of frequencies (same as contribution to dot product)
        termScores.push({ term, score: freq1 * freq2 });
      }
    }

    if (norm1 === 0 || norm2 === 0) {
      return { similarity: 0, commonTerms: [] };
    }

    // Sort terms by their score (highest first) and take top 10
    const topCommonTerms = termScores
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .map(item => item.term);

    return {
      similarity: dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2)),
      commonTerms: topCommonTerms || []
    };
  }
}
