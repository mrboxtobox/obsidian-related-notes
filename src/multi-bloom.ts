/**
 * @file Multi-resolution bloom filter implementation for the Related Notes plugin.
 * Uses multiple bloom filters with different n-gram sizes for better accuracy.
 */

'use strict';

import { tokenize, SimilarityProvider, SimilarityInfo } from './core';
import { BloomFilter } from './bloom';
import { TFile } from 'obsidian';
import { isDebugMode, logIfDebugModeEnabled } from './logging';
import {
  TEXT_PROCESSING,
  BLOOM_FILTER,
  BATCH_PROCESSING,
  WORD_FILTERING,
  TIMING,
  FILE_OPERATIONS,
  CACHE,
  MEMORY_LIMITS
} from './constants';
import {
  handleFileError,
  handleCacheError,
  handleValidationError
} from './error-handling';

/**
 * Optimal bloom filter size calculation
 * Based on expected number of items and desired false positive rate
 * @param itemCount Expected number of items
 * @param falsePositiveRate Desired false positive rate (0-1)
 * @returns Optimal size in bits
 */
export function calculateOptimalBloomSize(itemCount: number, falsePositiveRate: number): number {
  // Formula: size = -1 * (itemCount * ln(falsePositiveRate)) / (ln(2)^2)
  const size = Math.ceil(-1 * (itemCount * Math.log(falsePositiveRate)) / Math.pow(Math.log(2), 2));
  // Round up to nearest multiple of 32 for Uint32Array
  return Math.ceil(size / 32) * 32;
}

/**
 * Optimal hash function count calculation
 * @param size Bloom filter size in bits
 * @param itemCount Expected number of items
 * @returns Optimal number of hash functions
 */
export function calculateOptimalHashFunctions(size: number, itemCount: number): number {
  // Formula: k = (size/itemCount) * ln(2)
  return Math.max(1, Math.round((size / itemCount) * Math.log(2)));
}

/**
 * Single bloom filter that uses word-based tokenization
 * Optimized for better latency using a single resolution approach
 */
export class SingleBloomFilter {
  // Single bloom filter for simplicity
  readonly filter: BloomFilter;

  // Configuration
  readonly ngramSizes: number[];
  private readonly bloomSize: number;
  private readonly hashFunctionCount: number;

  // Statistics
  private readonly addedItems = new Set<string>();
  private itemCount = 0;

  /**
   * Creates a new bloom filter
   * @param ngramSizes Array of n-gram sizes (only first value is used, kept for backward compatibility)
   * @param bloomSizes Array of bloom filter sizes (only first value is used)
   * @param hashFunctions Array of hash function counts (only first value is used)
   */
  constructor(
    ngramSizes: number[] = [3], // Only the first value is actually used
    bloomSizes?: number[],
    hashFunctions?: number[]
  ) {
    // Keep the array for backward compatibility, but we only use first value
    this.ngramSizes = ngramSizes;

    // Significantly reduced bloom filter size since we're using word-level tokens
    // instead of character n-grams - this gives similar accuracy with better performance
    this.bloomSize = bloomSizes && bloomSizes.length > 0 ? bloomSizes[0] : 2048;
    this.hashFunctionCount = hashFunctions && hashFunctions.length > 0 ? hashFunctions[0] : 3;

    // Create single bloom filter
    this.filter = new BloomFilter(this.bloomSize, this.hashFunctionCount);

    if (isDebugMode()) {
      logIfDebugModeEnabled(`Created simplified BloomFilter with ${this.bloomSize} bits, ${this.hashFunctionCount} hash functions`);
    }
  }

  /**
   * Add text to the bloom filter
   * @param text The text to add
   */
  addText(text: string): void {
    this.addedItems.add(text);

    // Extract words from text
    const words = this.extractWords(text);

    // Add each word to the bloom filter
    for (const word of words) {
      this.filter.add(word);
      this.itemCount++;
    }

    if (isDebugMode()) {
      logIfDebugModeEnabled(`Added ${words.size} words to bloom filter`);
    }
  }

  /**
   * Calculate similarity between this filter and another
   * @param other The other filter
   * @returns Similarity score between 0 and 1
   */
  similarity(other: SingleBloomFilter): number {
    try {
      // Direct comparison of the underlying bloom filters
      return this.filter.similarity(other.filter);
    } catch (error) {
      console.error('Error comparing filters:', error);
      return 0;
    }
  }

  /**
   * Fast intersection count estimate for candidate selection
   * @param other The other filter
   * @returns Approximate intersection count (higher = more similar)
   */
  fastIntersectionCount(other: SingleBloomFilter): number {
    try {
      // Use the underlying bloom filter's intersection method
      return this.filter.intersectionCount(other.filter);
    } catch (error) {
      console.error('Error calculating fast intersection:', error);
      return 0;
    }
  }

  /**
   * Extract words from text, with special handling for CJK scripts
   * @param text Input text
   * @returns Set of words and word pairs
   */
  private extractWords(text: string): Set<string> {
    // Use the tokenize function to normalize text
    // The tokenize function now handles CJK scripts properly
    const processed = tokenize(text);

    // Split into words/tokens
    const words = processed.split(/\s+/);

    // Create a set of words (automatically deduplicates)
    const wordSet = new Set<string>(words);

    // Detect if text contains CJK characters
    const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(text);

    // Add word pairs (bigrams) for context
    // Use a lower limit for CJK text to avoid too many bigrams
    const maxBigrams = hasCJK ? BLOOM_FILTER.MAX_BIGRAMS_CJK : BLOOM_FILTER.MAX_BIGRAMS_NON_CJK;
    let count = 0;

    for (let i = 0; i < words.length - 1 && count < maxBigrams; i++) {
      const bigram = `${words[i]} ${words[i + 1]}`;
      wordSet.add(bigram);
      count++;
    }

    return wordSet;
  }

  /**
   * Get statistics about the bloom filter
   */
  getStats(): any {
    return {
      type: "simplified",
      bloomSize: this.bloomSize,
      hashFunctionCount: this.hashFunctionCount,
      itemCount: this.itemCount,
      totalMemoryBytes: this.bloomSize / 8,
      saturation: this.filter.getFalsePositiveRate(),
      addedItems: this.addedItems.size
    };
  }

  /**
   * These methods are kept for backward compatibility
   */
  getBitArray(): Uint32Array {
    return this.filter.getBitArray();
  }

  getSize(): number {
    return this.bloomSize;
  }

  getHashFunctions(): number {
    return this.hashFunctionCount;
  }

  getFalsePositiveRate(): number {
    return this.filter.getFalsePositiveRate();
  }

  filters = {
    get: (ngramSize: number) => ngramSize === this.ngramSizes[0] ? this.filter : undefined
  };
}

/**
 * Adaptive parameter calculator for bloom filters
 * Automatically determines optimal bloom filter parameters based on corpus characteristics
 */
export class AdaptiveParameterCalculator {
  private documentLengths: number[] = [];
  private vocabularySizes: number[] = [];
  private averageDocLength = 0;
  private averageVocabularySize = 0;
  private documentsAnalyzed = 0;

  /**
   * Track document statistics to inform parameter decisions
   * @param text Document text
   */
  analyzeDocument(text: string): void {
    const processed = tokenize(text);
    const words = processed.toLowerCase().split(/\s+/);
    const uniqueWords = new Set(words);

    this.documentLengths.push(words.length);
    this.vocabularySizes.push(uniqueWords.size);
    this.documentsAnalyzed++;

    // Update averages
    this.averageDocLength = this.documentLengths.reduce((sum, len) => sum + len, 0) / this.documentsAnalyzed;
    this.averageVocabularySize = this.vocabularySizes.reduce((sum, size) => sum + size, 0) / this.documentsAnalyzed;
  }

  /**
   * Calculate optimal n-gram sizes based on document characteristics
   * @returns Array of recommended n-gram sizes
   */
  calculateOptimalNgramSizes(): number[] {
    if (this.documentsAnalyzed < 10) {
      // Default n-gram size for small corpora - using a single size for simplicity
      return [3];
    }

    // Calculate average word length
    const avgWordLength = this.averageDocLength > 0 ?
      this.averageDocLength / this.averageVocabularySize : 5;

    // Always use a single n-gram size for simplicity regardless of word length
    return [3];
  }

  /**
   * Calculate optimal bloom filter sizes based on vocabulary size
   * @param ngramSizes Array of n-gram sizes
   * @param falsePositiveRate Desired false positive rate (default: 0.01)
   * @returns Array of recommended bloom filter sizes
   */
  calculateOptimalBloomSizes(ngramSizes: number[], falsePositiveRate: number = 0.01): number[] {
    // Always use a consistent bloom filter size (2048 bits) for all n-gram sizes
    // This ensures compatibility when comparing filters while reducing memory usage
    const fixedSize = BLOOM_FILTER.DEFAULT_FILTER_SIZE; // Reduced from 4096 for faster indexing
    return ngramSizes.map(() => fixedSize);

    /* Original adaptive code commented out for reference:
    if (this.documentsAnalyzed < 10) {
      // Default bloom filter sizes for small corpora
      return ngramSizes.map(() => 256);
    }

    // Estimate number of n-grams for each size
    return ngramSizes.map(ngramSize => {
      // Estimate number of unique n-grams based on vocabulary size and n-gram size
      // This is a heuristic approximation
      const estimatedNgrams = Math.ceil(this.averageVocabularySize * Math.pow(1.5, ngramSize - 1));
      // Calculate optimal bloom filter size
      return calculateOptimalBloomSize(estimatedNgrams, falsePositiveRate);
    });
    */
  }

  /**
   * Calculate optimal hash function counts
   * @param bloomSizes Array of bloom filter sizes
   * @param ngramSizes Array of n-gram sizes
   * @returns Array of recommended hash function counts
   */
  calculateOptimalHashFunctions(bloomSizes: number[], ngramSizes: number[]): number[] {
    // Calculate optimal hash function count for each bloom filter
    return bloomSizes.map((size, i) => {
      // Estimate number of unique n-grams as above
      const ngramSize = ngramSizes[i];
      const estimatedNgrams = Math.ceil(this.averageVocabularySize * Math.pow(1.5, ngramSize - 1));
      // Calculate optimal hash function count
      return calculateOptimalHashFunctions(size, estimatedNgrams);
    });
  }

  /**
   * Calculate optimal similarity threshold based on corpus characteristics
   * @returns Recommended similarity threshold (0-1)
   */
  calculateOptimalSimilarityThreshold(): number {
    return 0.15;

    if (this.documentsAnalyzed < 10) {
      // Default threshold for small corpora - lowered to find more matches
      return 0.15;
    }

    // Calculate coefficient of variation for document lengths
    const meanDocLength = this.averageDocLength;
    const variance = this.documentLengths.reduce(
      (sum, len) => sum + Math.pow(len - meanDocLength, 2), 0
    ) / this.documentsAnalyzed;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / meanDocLength;

    // Adjust threshold based on corpus homogeneity - lowered all thresholds
    if (cv < 0.3) {
      // Very homogeneous corpus: higher threshold
      return 0.25;
    } else if (cv < 0.6) {
      // Moderately varied corpus: medium threshold
      return 0.15;
    } else {
      // Highly varied corpus: lower threshold
      return 0.1;
    }
  }

  /**
   * Get statistics about analyzed documents
   */
  getStats(): any {
    return {
      documentsAnalyzed: this.documentsAnalyzed,
      averageDocLength: this.averageDocLength,
      averageVocabularySize: this.averageVocabularySize,
      minDocLength: Math.min(...this.documentLengths),
      maxDocLength: Math.max(...this.documentLengths),
      minVocabularySize: Math.min(...this.vocabularySizes),
      maxVocabularySize: Math.max(...this.vocabularySizes)
    };
  }

  /**
   * Generate a complete set of recommended parameters
   * @param falsePositiveRate Desired false positive rate
   * @returns Object containing all recommended parameters
   */
  generateRecommendedParameters(falsePositiveRate: number = 0.01): any {
    const ngramSizes = this.calculateOptimalNgramSizes();
    const bloomSizes = this.calculateOptimalBloomSizes(ngramSizes, falsePositiveRate);
    const hashFunctions = this.calculateOptimalHashFunctions(bloomSizes, ngramSizes);
    const similarityThreshold = this.calculateOptimalSimilarityThreshold();

    return {
      ngramSizes,
      bloomSizes,
      hashFunctions,
      similarityThreshold
    };
  }
}

/**
 * A similarity provider based on multi-resolution bloom filters
 * Implements the SimilarityProvider interface from core.ts
 */
export class MultiResolutionBloomFilterProvider implements SimilarityProvider {
  private readonly bloomFilters = new Map<string, SingleBloomFilter>();
  private readonly documentNgrams = new Map<string, Map<number, Set<string>>>();
  private readonly config: any;
  private readonly parameterCalculator = new AdaptiveParameterCalculator();
  private ngramSizes: number[];
  private bloomSizes: number[];
  private hashFunctions: number[];
  private similarityThreshold: number;
  private adaptiveParameters = false;
  private parameterUpdateInterval = BLOOM_FILTER.PARAMETER_UPDATE_INTERVAL; // Reduced from 100 to 50 for faster parameter adaptation
  private documentsProcessed = 0;
  private vault: any;
  private onProgressCallback: ((progress: number) => void) | null = null;
  private stopRequested = false;
  private isInitialized = false;
  private cacheReady = false;
  private cacheDirty = false;
  private cacheFilePath: string | undefined;
  private yieldInterval = 1; // Changed to yield after every document for smoother UI responsiveness
  private isSaving = false; // Prevent concurrent cache saves

  // Progressive indexing properties
  private remainingFilesToIndex: TFile[] = [];
  private hasPartialIndex = false;
  private isProgressiveIndexingRunning = false;
  private progressiveIndexingIntervalId: number | null = null;

  // Adaptive stopwords (reusing from BloomFilterSimilarityProvider)
  private readonly wordFrequencies = new Map<string, number>();
  private readonly wordDocumentCount = new Map<string, Set<string>>();
  private readonly commonWords = new Set<string>();
  private totalDocuments = 0;
  private commonWordsThreshold = 0.4; // Reduced from 0.5 to filter more words
  private commonWordsComputed = false;
  private minWordLength = 2;
  private maxStopwords = WORD_FILTERING.MAX_STOPWORDS; // Increased from 200 to filter more common words
  private maxWordFrequencyEntries = 50000; // Limit word frequency tracking to prevent memory leaks

  constructor(vault: any, config: any = {}) {
    this.vault = vault;
    this.config = config;

    // Initialize with default parameters
    this.ngramSizes = config.ngramSizes;
    this.bloomSizes = config.bloomSizes;
    this.hashFunctions = config.hashFunctions;
    this.similarityThreshold = config.similarityThreshold;

    // Enable adaptive parameters if specified
    this.adaptiveParameters = config.adaptiveParameters !== false;

    if (config.parameterUpdateInterval) {
      this.parameterUpdateInterval = config.parameterUpdateInterval;
    }

    // Configure adaptive stopwords parameters
    if (config.commonWordsThreshold) {
      this.commonWordsThreshold = config.commonWordsThreshold;
    }
    if (config.maxStopwords) {
      this.maxStopwords = config.maxStopwords;
    }
    if (config.minWordLength) {
      this.minWordLength = config.minWordLength;
    }

    // Configure yield interval
    if (config.yieldInterval) {
      this.yieldInterval = config.yieldInterval;
    }

    // Setup cache file path with validation
    if (vault.adapter && vault.configDir) {
      try {
        // Validate and normalize the config directory path
        const configDir = this.validateConfigDir(vault.configDir);
        this.cacheFilePath = `${configDir}${CACHE.RELATIVE_PATH}${CACHE.FILENAME}`;
        logIfDebugModeEnabled(`Cache path set to: ${this.cacheFilePath}`);
      } catch (error) {
        handleValidationError(error as Error, 'cache path setup', vault.configDir);
        this.cacheFilePath = undefined;
      }
    } else {
      console.warn('Vault adapter or configDir not available, cache will be disabled');
      this.cacheFilePath = undefined;
    }

    logIfDebugModeEnabled(`Created MultiResolutionBloomFilterProvider with:
      - n-gram size: ${this.ngramSizes[0]}
      - bloom size: ${this.bloomSizes[0]}
      - hash functions: ${this.hashFunctions[0]}
      - similarity threshold: ${this.similarityThreshold}
      - adaptive parameters: ${this.adaptiveParameters}
      - parameter update interval: ${this.parameterUpdateInterval} documents
      - adaptive stopwords: true (max: ${this.maxStopwords}, threshold: ${this.commonWordsThreshold * 100}%`);
  }

  /**
   * Initialize the similarity provider by processing all markdown files
   * @param onProgress Callback function for reporting progress
   */
  async initialize(onProgress?: (processed: number, total: number) => void): Promise<void> {
    if (this.isInitialized) return;

    this.stopRequested = false;

    try {
      // Try to load from cache first - always prefer cache if it exists
      const cachedLoaded = await this.loadFromCache();
      if (cachedLoaded) {
        logIfDebugModeEnabled(`Successfully loaded index from cache with ${this.bloomFilters.size} documents`);
        this.isInitialized = true;

        // Still report 100% progress
        if (onProgress) {
          const totalFiles = this.vault.getMarkdownFiles().length;
          onProgress(totalFiles, totalFiles);
        }
        return;
      }

      // Get all markdown files
      const markdownFiles = this.vault.getMarkdownFiles();
      const totalFiles = markdownFiles.length;
      logIfDebugModeEnabled(`Initializing with ${totalFiles} markdown files`);

      // Improved yielding function
      const yield_to_main = async () => {
        await new Promise(resolve => setTimeout(resolve, 15)); // 15ms yield gives UI more breathing room
      };

      // Process files in smaller batches for better UI responsiveness
      const batchSize = BATCH_PROCESSING.SMALL_BATCH_SIZE; // Even smaller batch size for more frequent UI updates
      let processedCount = 0;

      // Enhanced yielding function with variable durations
      const yieldWithDuration = async (ms: number) => {
        await new Promise(resolve => setTimeout(resolve, ms));
      };

      // Optimize for large vaults
      const LARGE_VAULT_THRESHOLD = WORD_FILTERING.LARGE_VAULT_THRESHOLD;
      const isLargeVault = totalFiles > LARGE_VAULT_THRESHOLD;

      // For large vaults, we may want to process only a subset of files
      // or prioritize certain files during initial indexing
      let filesToProcess = markdownFiles;

      // Check if sampling is enabled in the config and this is a large vault
      const enableSampling = this.config.enableSampling !== undefined
        ? this.config.enableSampling
        : true; // Default to true if not specified

      // Get max sample size from config or use default
      const maxSampleSize = this.config.maxSampleSize || 5000;

      if (isLargeVault && enableSampling) {
        logIfDebugModeEnabled(`Large vault detected (${totalFiles} files). Using progressive indexing strategy.`);

        // For progressive indexing of large vaults:
        // 1. First index a set of active/recent files (last 30 days)
        // 2. Include any currently open files
        // 3. Include a random sample of other files

        // Priority 1: Get recently modified files (last 30 days)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        const recentFiles = markdownFiles.filter((file: TFile) => file.stat.mtime > thirtyDaysAgo);

        // Priority 2: Get currently active file
        const activeLeaf = this.vault.getActiveLeaf?.();
        const activeFile = activeLeaf?.view?.file as TFile | undefined;
        const activeFiles: TFile[] = [];

        if (activeFile && !recentFiles.includes(activeFile)) {
          activeFiles.push(activeFile);
        }

        // Mark these files to be indexed first
        const priorityFiles = [...recentFiles, ...activeFiles];

        // Determine how many files to include in initial indexing (max 1000 or 10% of vault)
        const initialIndexSize = Math.min(1000, Math.ceil(totalFiles * 0.1));

        // If we already have enough priority files, use those
        if (priorityFiles.length >= initialIndexSize) {
          logIfDebugModeEnabled(`Using ${priorityFiles.length} priority files for initial indexing`);
          filesToProcess = priorityFiles.slice(0, initialIndexSize);
        }
        // Otherwise, supplement with random files
        else {
          // Create a list of non-priority files
          const remainingFiles = markdownFiles.filter((file: TFile) => !priorityFiles.includes(file));

          // Shuffle the remaining files for random sampling
          const shuffledRemaining = [...remainingFiles];
          for (let i = shuffledRemaining.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledRemaining[i], shuffledRemaining[j]] = [shuffledRemaining[j], shuffledRemaining[i]];
          }

          // Take enough random files to reach our target initial index size
          const randomSampleCount = initialIndexSize - priorityFiles.length;
          const randomSample = shuffledRemaining.slice(0, randomSampleCount);

          // Combine priority files with random sample
          filesToProcess = [...priorityFiles, ...randomSample];

          logIfDebugModeEnabled(`Using ${priorityFiles.length} priority files and ${randomSample.length} random files for initial indexing`);
        }

        // Store the information about remaining files for later progressive indexing
        this.remainingFilesToIndex = markdownFiles.filter((file: TFile) => !filesToProcess.includes(file));
        this.hasPartialIndex = true;

        logIfDebugModeEnabled(`Progressive indexing: Processing ${filesToProcess.length} files initially out of ${totalFiles} total (${this.remainingFilesToIndex.length} files will be indexed later)`);

        // Schedule background indexing of remaining files
        setTimeout(() => this.scheduleProgressiveIndexing(), 60000); // Start after 1 minute
      }

      // Process files in batches
      for (let i = 0; i < filesToProcess.length; i += batchSize) {
        if (this.stopRequested) {
          logIfDebugModeEnabled('Initialization stopped by user');
          // Explicitly throw cancellation error to propagate up the promise chain
          throw new Error('Indexing cancelled');
        }

        // Process a batch of files
        const batch = filesToProcess.slice(i, Math.min(i + batchSize, filesToProcess.length));

        // Update progress at start of batch - calculate proper percentage
        if (onProgress) {
          // If we're sampling, adjust the progress reporting to show progress relative to the total files
          if (isLargeVault) {
            const progressPercentage = (processedCount / filesToProcess.length) * 100;
            // Map the percentage to the total files to show accurate progress
            const scaledProcessed = Math.floor((progressPercentage / 100) * totalFiles);
            onProgress(scaledProcessed, totalFiles);
          } else {
            onProgress(processedCount, totalFiles);
          }
        }

        // Longer yield before processing batch
        await yieldWithDuration(20);

        // Process each file in the batch
        for (const file of batch) {
          if (this.stopRequested) {
            logIfDebugModeEnabled('Initialization stopped by user during batch processing');
            // Explicitly throw cancellation error to propagate up the promise chain
            throw new Error('Indexing cancelled');
          }

          try {
            // Read file content with yield before potentially expensive operation
            await yieldWithDuration(5);
            const content = await this.vault.cachedRead(file);
            await yieldWithDuration(5);

            // Process document
            await this.processDocument(file.path, content);
            processedCount++;

            // Update progress after each file for more responsive UI
            if (onProgress) {
              // If we're sampling, adjust the progress reporting
              if (isLargeVault) {
                const progressPercentage = (processedCount / filesToProcess.length) * 100;
                // Map the percentage to the total files to show accurate progress
                const scaledProcessed = Math.floor((progressPercentage / 100) * totalFiles);
                onProgress(scaledProcessed, totalFiles);
              } else {
                onProgress(processedCount, totalFiles);
              }
            }

            // Extended yield after every document
            await yieldWithDuration(30); // Longer yield for better UI responsiveness
          } catch (error) {
            console.error(`Error processing file ${file.path}:`, error);
          }
        }

        // Extra long yield to main thread after each batch
        // This ensures the UI remains responsive even during intensive indexing
        await yieldWithDuration(50);
      }

      // Save the cache after initialization
      await this.saveToCache();

      logIfDebugModeEnabled(`Initialization complete: processed ${this.bloomFilters.size} files`);
      this.isInitialized = true;
    } catch (error) {
      console.error('Error during initialization:', error);
      throw error;
    }
  }

  /**
   * Stop any ongoing initialization
   */
  stop(): void {
    this.stopRequested = true;

    // Also stop progressive indexing if it's running
    if (this.progressiveIndexingIntervalId !== null) {
      clearInterval(this.progressiveIndexingIntervalId);
      this.progressiveIndexingIntervalId = null;
      this.isProgressiveIndexingRunning = false;
    }

    // Log that stop was requested to help with debugging
    if (isDebugMode()) {
      logIfDebugModeEnabled('Stop requested for ongoing indexing operation');
    }
  }

  /**
   * Schedule progressive indexing of remaining files
   * This method processes files in small batches during idle time
   * to avoid impacting performance during active use
   */
  private scheduleProgressiveIndexing(): void {
    // Don't schedule if already running or no files to process
    if (this.isProgressiveIndexingRunning || this.remainingFilesToIndex.length === 0) {
      return;
    }

    if (isDebugMode()) {
      logIfDebugModeEnabled(`Scheduling progressive indexing for ${this.remainingFilesToIndex.length} remaining files`);
    }

    this.isProgressiveIndexingRunning = true;

    // Process a small batch of files every few minutes
    // This spreads the indexing load over time
    const BATCH_SIZE = BATCH_PROCESSING.FILES_PER_BATCH; // Process 20 files at a time
    const INTERVAL_MINUTES = BATCH_PROCESSING.PROGRESSIVE_INTERVAL_MINUTES; // Process a batch every 5 minutes

    let progressiveIndexCount = 0;

    // Function to process a small batch of files
    const processBatch = async () => {
      // Stop if requested or no more files
      if (this.stopRequested || this.remainingFilesToIndex.length === 0) {
        if (this.progressiveIndexingIntervalId !== null) {
          clearInterval(this.progressiveIndexingIntervalId);
          this.progressiveIndexingIntervalId = null;
          this.isProgressiveIndexingRunning = false;
        }

        if (isDebugMode()) {
          logIfDebugModeEnabled(`Progressive indexing completed or stopped after processing ${progressiveIndexCount} files`);
        }

        // Save cache after batch processing
        await this.saveToCache();
        return;
      }

      // Take the next batch of files
      const batchToProcess = this.remainingFilesToIndex.splice(0, BATCH_SIZE);

      if (isDebugMode()) {
        logIfDebugModeEnabled(`Progressive indexing: processing batch of ${batchToProcess.length} files (${this.remainingFilesToIndex.length} remaining)`);
      }

      // Process each file with yields between operations
      for (const file of batchToProcess) {
        try {
          // Yield to avoid blocking UI
          await new Promise(resolve => setTimeout(resolve, 50));

          // Read file content
          const content = await this.vault.cachedRead(file);

          // Process document
          await this.processDocument(file.path, content);
          progressiveIndexCount++;

          // Yield again after processing
          await new Promise(resolve => setTimeout(resolve, 20));
        } catch (error) {
          console.error(`Error during progressive indexing of ${file.path}:`, error);
        }
      }

      // Save cache after batch processing
      this.cacheDirty = true;
      await this.saveToCache();

      // If no more files to process, clean up
      if (this.remainingFilesToIndex.length === 0) {
        if (this.progressiveIndexingIntervalId !== null) {
          clearInterval(this.progressiveIndexingIntervalId);
          this.progressiveIndexingIntervalId = null;
        }
        this.isProgressiveIndexingRunning = false;
        this.hasPartialIndex = false;

        if (isDebugMode()) {
          logIfDebugModeEnabled(`Progressive indexing completed after processing ${progressiveIndexCount} files`);
        }
      }
    };

    // Start the first batch immediately
    processBatch();

    // Schedule future batches
    this.progressiveIndexingIntervalId = window.setInterval(processBatch, INTERVAL_MINUTES * 60 * 1000);
  }

  /**
   * Force a complete reindexing of all files
   * @param onProgress Progress callback
   */
  async forceReindex(onProgress: (processed: number, total: number) => void): Promise<void> {
    // Reset stop flag before starting
    this.stopRequested = false;

    // Stop any progressive indexing that might be in progress
    if (this.progressiveIndexingIntervalId !== null) {
      clearInterval(this.progressiveIndexingIntervalId);
      this.progressiveIndexingIntervalId = null;
      this.isProgressiveIndexingRunning = false;
    }

    // Clear existing data
    this.bloomFilters.clear();
    this.documentNgrams.clear();
    this.remainingFilesToIndex = [];
    this.hasPartialIndex = false;

    // Reset stopwords detection
    this.commonWords.clear();
    this.commonWordsComputed = false;
    this.totalDocuments = 0;

    // Mark cache as dirty
    this.cacheDirty = true;

    // Reinitialize
    this.isInitialized = false;

    try {
      return await this.initialize(onProgress);
    } catch (error) {
      // If it's a cancellation error, properly propagate it
      if (error instanceof Error && error.message === 'Indexing cancelled') {
        throw error; // Re-throw the cancellation error
      }
      // For other errors, re-throw
      throw error;
    }
  }

  /**
   * Check if a file is indexed
   * @param file File to check
   */
  isFileIndexed(file: TFile): boolean {
    return this.bloomFilters.has(file.path);
  }

  /**
   * Get candidate similar files for a given file
   * Implements the SimilarityProvider interface
   * @param file The file to find candidates for
   * @returns Array of potential similar files
   */
  async getCandidateFiles(file: TFile): Promise<TFile[]> {
    if (!this.isInitialized) {
      if (isDebugMode()) {
        logIfDebugModeEnabled(`Provider not initialized yet, returning empty candidates list for ${file.path}`);
      }
      return [];
    }

    try {
      // If the file isn't in our index yet, process it
      if (!this.bloomFilters.has(file.path)) {
        if (isDebugMode()) {
          logIfDebugModeEnabled(`File ${file.path} not in index yet, will process on-demand`);
        }

        // Return empty for now - computeCappedCosineSimilarity will handle on-demand processing
        return [];
      }

      try {
        // Get similar documents - no threshold, just the top N results with non-zero similarity
        const maxResults = this.config.maxSuggestions || 20; // Provide a reasonable default if config is missing

        // Determine if we should use sampling for large corpus
        const corpusSize = this.bloomFilters.size;

        // Check if sampling is enabled in the config
        const enableSampling = this.config.enableSampling !== undefined
          ? this.config.enableSampling
          : true; // Default to true if not specified

        // Get thresholds from config or use defaults
        const sampleSizeThreshold = this.config.sampleSizeThreshold || 5000;
        const maxSampleSize = this.config.maxSampleSize || 1000;

        // For large corpora, use smart candidate selection instead of random sampling
        let candidateDocuments: string[];
        
        if (enableSampling && corpusSize > sampleSizeThreshold) {
          // Smart candidate selection for large vaults
          candidateDocuments = await this.getSmartCandidates(file.path, maxSampleSize);
        } else {
          // Small vault - use all documents
          candidateDocuments = Array.from(this.bloomFilters.keys()).filter(path => path !== file.path);
        }

        // Get similar documents from the candidate set
        const similarDocuments = await this.getSimilarDocuments(file.path, maxResults, undefined, candidateDocuments);

        // Convert paths to files
        const markdownFiles = this.vault.getMarkdownFiles();
        const pathToFile = new Map<string, any>();

        for (const mdFile of markdownFiles) {
          pathToFile.set(mdFile.path, mdFile);
        }

        // Return the files with their similarity scores
        const result = similarDocuments
          .map(([path, similarity]) => {
            const matchedFile = pathToFile.get(path);
            if (matchedFile) {
              // Store the similarity score with the file
              (matchedFile as any).similarity = similarity;
              return matchedFile;
            }
            return null;
          })
          .filter(f => f !== null);

        if (isDebugMode()) {
          logIfDebugModeEnabled(`Found ${result.length} candidate files for ${file.path}`);
        }

        return result;
      } catch (error) {
        console.error(`Error in similarity calculation for ${file.path}:`, error);
        // Continue with an empty result rather than crashing
        return [];
      }
    } catch (error) {
      console.error(`Error getting candidate files for ${file.path}:`, error);
      return [];
    }
  }

  /**
   * Compute similarity between two files
   * Implements the SimilarityProvider interface
   * @param file1 First file
   * @param file2 Second file
   * @returns Similarity info with score and common terms
   */
  async computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo> {
    if (!this.isInitialized) {
      return { similarity: 0 };
    }

    try {
      // If either file isn't in our index yet, process it
      if (!this.bloomFilters.has(file1.path)) {
        const content1 = await this.vault.cachedRead(file1);
        this.processDocument(file1.path, content1);
      }

      if (!this.bloomFilters.has(file2.path)) {
        const content2 = await this.vault.cachedRead(file2);
        this.processDocument(file2.path, content2);
      }

      // Calculate similarity
      const similarity = this.calculateSimilarity(file1.path, file2.path);

      // Extract common terms for display (if available)
      const commonTerms = this.extractCommonTerms(file1.path, file2.path);

      return {
        similarity
      };
    } catch (error) {
      console.error(`Error computing similarity between ${file1.path} and ${file2.path}:`, error);
      return { similarity: 0 };
    }
  }

  /**
   * Extract common terms between two documents
   * @param docId1 First document ID
   * @param docId2 Second document ID
   * @returns Array of common terms
   */
  private extractCommonTerms(docId1: string, docId2: string): string[] {
    // If we don't have n-grams for either document, return empty array
    if (!this.documentNgrams.has(docId1) || !this.documentNgrams.has(docId2)) {
      return [];
    }

    try {
      // Get the document n-grams (from any n-gram size)
      const ngrams1Map = this.documentNgrams.get(docId1);
      const ngrams2Map = this.documentNgrams.get(docId2);

      if (!ngrams1Map || !ngrams2Map) {
        return [];
      }

      // Choose the first available n-gram size for each document
      const ngramSize1 = Array.from(ngrams1Map.keys())[0];
      const ngramSize2 = Array.from(ngrams2Map.keys())[0];

      if (ngramSize1 === undefined || ngramSize2 === undefined) {
        return [];
      }

      const ngrams1 = ngrams1Map.get(ngramSize1);
      const ngrams2 = ngrams2Map.get(ngramSize2);

      if (!ngrams1 || !ngrams2) {
        return [];
      }

      // Find common n-grams
      const commonNgrams = [...ngrams1].filter(n => ngrams2.has(n));

      // Return up to 10 common terms
      return commonNgrams.slice(0, 10);
    } catch (error) {
      console.error(`Error extracting common terms for ${docId1} and ${docId2}:`, error);
      return [];
    }
  }

  /**
   * Process a document and create bloom filters with memory safety
   * @param docId Document identifier
   * @param text Document text
   */
  async processDocument(docId: string, text: string): Promise<void> {
    // Memory circuit breaker - check if we should trigger cleanup
    if (this.documentsProcessed > 0 && this.documentsProcessed % MEMORY_LIMITS.MAX_DOCUMENTS_BEFORE_CLEANUP === 0) {
      logIfDebugModeEnabled(`Memory circuit breaker: triggering cleanup after ${this.documentsProcessed} documents`);
      this.performMemoryCleanup();
    }

    // Skip documents that are too large to prevent memory issues
    const maxDocSize = MEMORY_LIMITS.MAX_DOCUMENT_SIZE_MB * 1024 * 1024;
    if (text.length > maxDocSize) {
      logIfDebugModeEnabled(`Skipping document ${docId} - too large: ${text.length} chars (max: ${maxDocSize})`);
      return;
    }

    this.cacheDirty = true;
    const startTime = performance.now();

    // More aggressive yielding to ensure UI responsiveness
    const yieldWithDuration = async (ms: number) => {
      await new Promise(resolve => setTimeout(resolve, ms));
    };

    // Initial yield before any processing
    await yieldWithDuration(TIMING.YIELD_DURATION_MS);

    // Skip adaptive parameters for better performance
    this.documentsProcessed++;

    // For very large documents, limit the content to process
    // This drastically improves performance for huge files
    const processLimit = TEXT_PROCESSING.LARGE_DOCUMENT_LIMIT; // Character limit
    const isLargeDocument = text.length > processLimit;

    if (isLargeDocument) {
      logIfDebugModeEnabled(`Large document detected (${text.length} chars), limiting to ${processLimit} chars`);
    }

    const limitedText = isLargeDocument ? this.smartTruncateText(text, processLimit) : text;

    // Track word frequencies for adaptive stopwords
    this.trackWordFrequencies(docId, limitedText);
    await yieldWithDuration(TIMING.YIELD_DURATION_MS);

    // Compute common words if enough documents processed
    if (this.totalDocuments >= 30 && !this.commonWordsComputed) {
      this.computeCommonWords();
      await yieldWithDuration(TIMING.EXTENDED_YIELD_DURATION_MS);
    }

    // Create a simplified bloom filter (word-based, single resolution)
    const filter = new SingleBloomFilter(
      [3], // Single n-gram size (kept as array for backward compatibility)
      [2048], // Reduced bloom filter size for word-level indexing
      [3] // Hash functions
    );

    // Pre-process text to filter stopwords if we've computed them
    const processed = this.preprocessText(limitedText);
    await yieldWithDuration(TIMING.YIELD_DURATION_MS);

    // CPU throttling: process in small chunks with mandatory yields
    const words = processed.split(/\s+/);
    const CHUNK_SIZE = TIMING.MAX_OPERATIONS_BEFORE_YIELD; // Small chunks to prevent CPU hogging
    
    for (let i = 0; i < words.length; i += CHUNK_SIZE) {
      const chunk = words.slice(i, i + CHUNK_SIZE).join(' ');
      filter.addText(chunk);
      
      // Mandatory yield after every chunk to keep UI responsive
      await yieldWithDuration(TIMING.MIN_YIELD_TIME_MS);
    }

    // Store the filter
    this.bloomFilters.set(docId, filter);

    // No longer storing n-grams for memory efficiency

    const endTime = performance.now();

    // Final yield to ensure UI responsiveness
    await yieldWithDuration(5);

    if (isDebugMode()) {
      logIfDebugModeEnabled(`Processed document ${docId} in ${(endTime - startTime).toFixed(2)}ms`);
    }
  }

  /**
   * Extract n-grams from text for a specific n-gram size
   * @param text Input text
   * @param ngramSize Size of n-grams to extract
   * @returns Set of n-grams
   */
  private extractNgrams(text: string, ngramSize: number): Set<string> {
    // Prepare text by removing extra spaces
    // Use a Unicode-aware normalization to ensure consistent handling across languages
    const chars = text.toLowerCase().normalize('NFC').replace(/\s+/g, ' ');

    // Extract character n-grams with Unicode awareness
    const ngrams = new Set<string>();

    // This will properly handle multi-byte characters in languages like Chinese, Japanese, etc.
    for (let i = 0; i <= [...chars].length - ngramSize; i++) {
      // Use Array.from to properly handle Unicode characters
      const ngram = [...chars].slice(i, i + ngramSize).join('');
      if (ngram.length === ngramSize) {
        ngrams.add(ngram);
      }
    }

    return ngrams;
  }

  /**
   * Preprocess text by removing common words
   * @param text Input text
   * @returns Preprocessed text
   */
  private preprocessText(text: string): string {
    // Use the tokenize function from core
    const processed = tokenize(text);

    // Split into words
    const words = processed.toLowerCase().split(/\s+/);

    // Filter out common words if we've computed them
    let meaningfulWords: string[];

    if (this.commonWordsComputed) {
      // Use adaptive stopwords
      meaningfulWords = words.filter(word =>
        word.length > this.minWordLength && !this.commonWords.has(word)
      );
    } else {
      // Just filter by length until we have enough data
      meaningfulWords = words.filter(word => word.length > this.minWordLength);
    }

    return meaningfulWords.join(' ');
  }

  /**
   * Calculate similarity between two documents
   * @param docId1 First document ID
   * @param docId2 Second document ID
   * @returns Similarity score between 0 and 1
   */
  calculateSimilarity(docId1: string, docId2: string): number {
    const startTime = performance.now();

    // Get the filters for both documents
    const filter1 = this.bloomFilters.get(docId1);
    const filter2 = this.bloomFilters.get(docId2);

    // If either filter is missing, return 0
    if (!filter1 || !filter2) {
      if (isDebugMode()) {
        if (!filter1) logIfDebugModeEnabled(`Document ${docId1} not found`);
        if (!filter2) logIfDebugModeEnabled(`Document ${docId2} not found`);
      }
      return 0;
    }

    // Calculate the multi-resolution similarity
    const similarity = filter1.similarity(filter2);

    const endTime = performance.now();

    if (isDebugMode()) {
      logIfDebugModeEnabled(`Similarity calculation for ${docId1} and ${docId2}: ${(similarity * 100).toFixed(2)}% in ${(endTime - startTime).toFixed(2)}ms`);
    }

    return similarity;
  }

  /**
   * Get smart candidates for similarity comparison in large vaults
   * Uses multiple strategies to find the most likely similar documents
   * @param queryDocId Query document ID  
   * @param maxCandidates Maximum number of candidates to return
   * @returns Array of candidate document IDs
   */
  async getSmartCandidates(queryDocId: string, maxCandidates: number): Promise<string[]> {
    const queryFilter = this.bloomFilters.get(queryDocId);
    if (!queryFilter) {
      return [];
    }

    const allDocIds = Array.from(this.bloomFilters.keys()).filter(id => id !== queryDocId);
    const candidates = new Set<string>();

    // Strategy 1: Fast bloom filter intersection check (top 70% most promising)
    const fastCandidates: Array<[string, number]> = [];
    
    for (const docId of allDocIds) {
      const otherFilter = this.bloomFilters.get(docId);
      if (otherFilter) {
        // Quick intersection estimate using hamming distance
        const intersection = queryFilter.fastIntersectionCount(otherFilter);
        if (intersection > 0) {
          fastCandidates.push([docId, intersection]);
        }
      }
    }

    // Sort by intersection count and take top candidates
    fastCandidates.sort((a, b) => b[1] - a[1]);
    const topFastCandidates = fastCandidates
      .slice(0, Math.min(Math.ceil(maxCandidates * 0.7), 700))
      .map(([docId]) => docId);

    topFastCandidates.forEach(docId => candidates.add(docId));

    // Strategy 2: Recently modified files (recency bias)
    const recentFiles = this.vault.getMarkdownFiles()
      .filter((file: TFile) => file.stat.mtime > Date.now() - (30 * 24 * 60 * 60 * 1000)) // Last 30 days
      .slice(0, Math.ceil(maxCandidates * 0.2))
      .map((file: TFile) => file.path)
      .filter((path: string) => this.bloomFilters.has(path) && path !== queryDocId);

    recentFiles.forEach((path: string) => candidates.add(path));

    // Strategy 3: Random sampling from remaining documents (exploration)
    const remaining = allDocIds.filter(docId => !candidates.has(docId));
    const randomSampleSize = Math.min(
      Math.ceil(maxCandidates * 0.1),
      remaining.length,
      100
    );

    for (let i = 0; i < randomSampleSize; i++) {
      const randomIndex = Math.floor(Math.random() * remaining.length);
      candidates.add(remaining[randomIndex]);
    }

    const result = Array.from(candidates).slice(0, maxCandidates);
    
    if (isDebugMode()) {
      logIfDebugModeEnabled(`Smart candidate selection: ${result.length} candidates from ${allDocIds.length} total documents`);
    }

    return result;
  }

  /**
   * Get most similar documents to a query document with CPU throttling
   * @param queryDocId Query document ID
   * @param limit Maximum number of results
   * @param sampleSize Optional: Number of documents to sample when corpus is large (deprecated)
   * @param candidateDocIds Optional: Specific candidate documents to compare against
   * @returns Array of [docId, similarity] pairs, sorted by similarity
   */
  async getSimilarDocuments(
    queryDocId: string,
    limit: number = 10,
    sampleSize?: number,
    candidateDocIds?: string[]
  ): Promise<[string, number][]> {
    const startTime = performance.now();

    // Get the filter for the query document
    const queryFilter = this.bloomFilters.get(queryDocId);
    if (!queryFilter) {
      logIfDebugModeEnabled(`Query document ${queryDocId} not found`);
      return [];
    }

    const results: [string, number][] = [];
    let comparisons = 0;
    let skippedComparisons = 0;
    let operationsSinceYield = 0;

    // Determine which documents to compare against
    let documentsToProcess: Iterable<[string, any]>;
    
    if (candidateDocIds && candidateDocIds.length > 0) {
      // Use provided candidate documents
      documentsToProcess = candidateDocIds
        .filter(docId => docId !== queryDocId && this.bloomFilters.has(docId))
        .map(docId => [docId, this.bloomFilters.get(docId)!]);
      
      logIfDebugModeEnabled(`Using ${candidateDocIds.length} smart candidates for similarity comparison`);
    } else {
      // Fallback to legacy sampling approach
      const corpusSize = this.bloomFilters.size;
      const shouldSample = sampleSize && corpusSize > sampleSize;

      // Convert to array for sampling if needed
      const docEntries = shouldSample
        ? Array.from(this.bloomFilters.entries())
        : null;

      // If sampling, select a random subset
      documentsToProcess = shouldSample
        ? this.sampleDocuments(docEntries!, sampleSize, queryDocId)
        : this.bloomFilters.entries();

      if (shouldSample) {
        logIfDebugModeEnabled(`Large corpus detected (${corpusSize} documents), sampling ${sampleSize} documents`);
      }
    }

    // Compare with candidate documents with CPU throttling
    for (const [docId, filter] of documentsToProcess) {
      if (docId === queryDocId) continue; // Skip self-comparison

      // CPU throttling: yield control after processing a batch
      if (++operationsSinceYield >= TIMING.MAX_OPERATIONS_BEFORE_YIELD) {
        await new Promise(resolve => setTimeout(resolve, TIMING.MIN_YIELD_TIME_MS));
        operationsSinceYield = 0;
      }

      comparisons++;

      try {
        // Calculate similarity - safe version that won't throw on size mismatch
        const similarity = queryFilter.similarity(filter);

        // Include all non-zero similarities (no threshold)
        if (similarity > 0) {
          results.push([docId, similarity]);
        }
      } catch (error) {
        // Log error but continue processing other documents
        skippedComparisons++;
        if (isDebugMode()) {
          logIfDebugModeEnabled(`Error comparing ${queryDocId} with ${docId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }

    // Sort by similarity and limit results
    const sortedResults = results
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);

    const endTime = performance.now();

    logIfDebugModeEnabled(`Found ${sortedResults.length} similar documents to ${queryDocId}:
      - Compared with ${comparisons - skippedComparisons} documents (${skippedComparisons} skipped)
      - ${candidateDocIds ? `Using smart candidates (${candidateDocIds.length} candidates)` : 'Using all documents'}
      - No threshold applied, showing top ${limit} non-zero matches
      - Time: ${(endTime - startTime).toFixed(2)}ms
      ${sortedResults.length > 0 ? `- Top match: ${sortedResults[0][0]} (${(sortedResults[0][1] * 100).toFixed(1)}%)` : ''}`);

    return sortedResults;
  }

  /**
   * Sample a subset of documents for similarity comparison
   * Uses pure random sampling to discover diverse connections
   * @param documents Array of [docId, filter] pairs
   * @param sampleSize Number of documents to sample
   * @param queryDocId The ID of the query document (to exclude)
   * @returns Array of sampled [docId, filter] pairs
   */
  private sampleDocuments(
    documents: [string, SingleBloomFilter][],
    sampleSize: number,
    queryDocId: string
  ): [string, SingleBloomFilter][] {
    // Skip the query document
    const filteredDocs = documents.filter(([docId]) => docId !== queryDocId);

    // If we have fewer documents than the sample size, return all
    if (filteredDocs.length <= sampleSize) {
      return filteredDocs;
    }

    // Create a copy for shuffling
    const docsToSample = [...filteredDocs];

    // Fisher-Yates shuffle for unbiased random sampling
    for (let i = docsToSample.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [docsToSample[i], docsToSample[j]] = [docsToSample[j], docsToSample[i]];
    }

    // Take a random sample up to the requested size
    return docsToSample.slice(0, sampleSize);
  }

  /**
   * Update parameters based on corpus analysis
   */
  private updateParameters(): void {
    if (!this.adaptiveParameters || this.documentsProcessed < 25) return; // Reduced from 50 to 25 for faster adaptation

    const params = this.parameterCalculator.generateRecommendedParameters(0.05); // Increased false positive rate from 0.01 to 0.05 for better performance

    // Log changes to parameters
    logIfDebugModeEnabled(`Updating parameters after analyzing ${this.documentsProcessed} documents:
      - n-gram sizes: [${this.ngramSizes.join(', ')}] -> [${params.ngramSizes.join(', ')}]
      - bloom sizes: [${this.bloomSizes.join(', ')}] (keeping fixed size for compatibility)
      - hash functions: [${this.hashFunctions.join(', ')}] -> [${params.hashFunctions.join(', ')}]
      - similarity threshold: ${this.similarityThreshold} -> ${params.similarityThreshold}`);

    // Update parameters
    this.ngramSizes = params.ngramSizes;
    // Keep bloom sizes fixed for compatibility
    // this.bloomSizes = params.bloomSizes; 
    this.hashFunctions = params.hashFunctions;
    this.similarityThreshold = params.similarityThreshold;
  }

  /**
   * Track word frequencies and document occurrences to identify common words
   * @param docId Document identifier
   * @param text Document text
   */
  private trackWordFrequencies(docId: string, text: string): void {
    if (this.commonWordsComputed) return; // Skip if we've already computed common words

    // If we've hit the limit, compute common words early to free memory
    if (this.wordFrequencies.size >= this.maxWordFrequencyEntries) {
      this.computeCommonWords();
      return;
    }

    // Use the tokenize function from core
    const processed = tokenize(text);

    // Get unique words from the document
    const words = processed.toLowerCase().split(/\s+/);
    const uniqueWords = new Set<string>();

    // Count word frequencies with memory limits
    for (const word of words) {
      if (word.length <= this.minWordLength) continue; // Skip very short words
      
      // Stop adding new words if we hit the limit
      if (!this.wordFrequencies.has(word) && this.wordFrequencies.size >= this.maxWordFrequencyEntries) {
        break;
      }

      // Update overall word frequency
      this.wordFrequencies.set(word, (this.wordFrequencies.get(word) || 0) + 1);

      // Track unique words in this document
      uniqueWords.add(word);
    }

    // Track which documents each word appears in
    for (const word of uniqueWords) {
      if (!this.wordDocumentCount.has(word)) {
        // Stop adding new words if we hit the limit
        if (this.wordDocumentCount.size >= this.maxWordFrequencyEntries) {
          break;
        }
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
   * Get statistics about the provider
   */
  getStats(): any {
    const stats: any = {
      documentsProcessed: this.documentsProcessed,
      ngramSizes: this.ngramSizes,
      bloomSizes: this.bloomSizes,
      hashFunctions: this.hashFunctions,
      similarityThreshold: this.similarityThreshold,
      adaptiveParameters: this.adaptiveParameters,
      adaptiveStopwords: true,
      stopwordsComputed: this.commonWordsComputed,
      stopwordsCount: this.commonWords.size,
      stopwordsThreshold: this.commonWordsThreshold,
      maxStopwords: this.maxStopwords,
      documentsAnalyzed: this.totalDocuments,
      progressiveIndexing: {
        active: this.isProgressiveIndexingRunning,
        remainingFiles: this.remainingFilesToIndex.length,
        partialIndex: this.hasPartialIndex
      },
      memoryUsage: {
        totalBytes: 0,
        totalKB: 0,
        totalMB: 0
      }
    };

    // Calculate memory usage
    let totalMemoryBytes = 0;
    for (const filter of this.bloomFilters.values()) {
      const filterStats = filter.getStats();
      totalMemoryBytes += filterStats.totalMemoryBytes;
    }

    stats.memoryUsage.totalBytes = totalMemoryBytes;
    stats.memoryUsage.totalKB = totalMemoryBytes / 1024;
    stats.memoryUsage.totalMB = totalMemoryBytes / (1024 * 1024);

    // Add parameter calculator stats
    stats.corpusStats = this.parameterCalculator.getStats();

    return stats;
  }

  /**
   * Clear all bloom filters and free memory
   */
  clear(): void {
    this.bloomFilters.clear();
    this.documentNgrams.clear();
    // Clear adaptive stopwords data to free memory
    this.wordFrequencies.clear();
    this.wordDocumentCount.clear();
    this.commonWords.clear();
    this.commonWordsComputed = false;
    this.totalDocuments = 0;
    this.cacheDirty = true;
  }

  /**
   * Perform memory cleanup - called by circuit breaker
   */
  private performMemoryCleanup(): void {
    try {
      // Clear word frequency tracking to free memory
      if (this.wordFrequencies.size > 1000) {
        this.wordFrequencies.clear();
        logIfDebugModeEnabled('Cleared word frequencies to save memory');
      }

      if (this.wordDocumentCount.size > 1000) {
        this.wordDocumentCount.clear();
        logIfDebugModeEnabled('Cleared word document count to save memory');
      }

      // Force garbage collection hint (if available)
      if (typeof global !== 'undefined' && global.gc) {
        global.gc();
        logIfDebugModeEnabled('Triggered garbage collection');
      }

      // Log memory stats if available
      if (typeof process !== 'undefined' && process.memoryUsage) {
        const memUsage = process.memoryUsage();
        const memMB = Math.round(memUsage.heapUsed / 1024 / 1024);
        logIfDebugModeEnabled(`Memory usage after cleanup: ${memMB}MB`);
        
        // If still using too much memory, be more aggressive
        if (memMB > MEMORY_LIMITS.MAX_MEMORY_MB) {
          logIfDebugModeEnabled('Memory usage still high, performing aggressive cleanup');
          this.clear(); // Clear everything if needed
        }
      }
    } catch (error) {
      console.error('Error during memory cleanup:', error);
      // Never let cleanup crash the app
    }
  }

  /**
   * Get the number of documents indexed
   */
  size(): number {
    return this.bloomFilters.size;
  }

  /**
   * Save the bloom filter index to disk cache with corruption prevention
   */
  private async saveToCache(): Promise<boolean> {
    if (!this.cacheFilePath || !this.vault.adapter) {
      logIfDebugModeEnabled('Cannot save cache: no cache path or vault adapter');
      return false;
    }

    // Validate cache directory before attempting to save
    const isDirValid = await this.validateCacheDirectory();
    if (!isDirValid) {
      console.error('Cache directory is not accessible, cannot save cache');
      return false;
    }

    if (!this.cacheDirty) {
      logIfDebugModeEnabled('Cache is not dirty, skipping save');
      return true;
    }

    // Simple duplicate save prevention - just skip if already saving
    if (this.isSaving) {
      logIfDebugModeEnabled('Cache save already in progress, skipping duplicate save');
      return true; // Return success to avoid errors in calling code
    }
    this.isSaving = true;

    try {
      logIfDebugModeEnabled(`Saving bloom filter cache to ${this.cacheFilePath}`);

      // Prepare cache object
      const cache: any = {
        version: 1,
        timestamp: Date.now(),
        params: {
          ngramSizes: this.ngramSizes,
          bloomSizes: this.bloomSizes,
          hashFunctions: this.hashFunctions,
          similarityThreshold: this.similarityThreshold
        },
        stats: {
          documentCount: this.bloomFilters.size,
          commonWordsComputed: this.commonWordsComputed,
          commonWordsCount: this.commonWords.size,
          totalDocuments: this.totalDocuments
        },
        // Serialize bloom filters
        filters: {},
        // Serialize common words
        commonWords: Array.from(this.commonWords)
      };

      // Serialize each bloom filter (only store essential data)
      for (const [docId, filter] of this.bloomFilters.entries()) {
        // For each filter, serialize the bit arrays
        const filterData: any = {};

        // Store basic filter params
        filterData.ngramSizes = filter.ngramSizes;

        // For each n-gram size, store the bloom filter's bit array
        for (const ngramSize of filter.ngramSizes) {
          const bloomFilter = filter.filters.get(ngramSize);
          if (bloomFilter) {
            // Convert Uint32Array to regular array for serialization
            const bitArray = Array.from(bloomFilter.getBitArray());
            filterData[`bloom_${ngramSize}`] = bitArray;
          }
        }

        cache.filters[docId] = filterData;
      }

      // Create cache directory if it doesn't exist
      const cacheDir = this.cacheFilePath.substring(0, this.cacheFilePath.lastIndexOf('/'));
      await this.vault.adapter.mkdir(cacheDir);

      // Write to temporary file first to prevent corruption
      const tempCachePath = `${this.cacheFilePath}.tmp`;
      const cacheContent = JSON.stringify(cache);
      
      // Validate JSON serialization before writing
      try {
        JSON.parse(cacheContent); // Validate that we can parse what we just serialized
      } catch (parseError) {
        throw new Error(`Cache serialization validation failed: ${parseError}`);
      }

      // Save to temporary file with retry logic
      await this.executeFileOperationWithRetry(
        () => this.vault.adapter.write(tempCachePath, cacheContent),
        'Cache temp save operation'
      );

      // Verify temp file integrity
      const tempContent = await this.executeFileOperationWithRetry(
        () => this.vault.adapter.read(tempCachePath),
        'Cache temp verification'
      );
      
      try {
        const verifyCache = JSON.parse(tempContent as string);
        if (verifyCache.version !== cache.version || 
            Object.keys(verifyCache.filters).length !== Object.keys(cache.filters).length) {
          throw new Error('Cache verification failed: data mismatch');
        }
      } catch (verifyError) {
        await this.vault.adapter.remove(tempCachePath).catch(() => {}); // Cleanup temp file
        throw new Error(`Cache verification failed: ${verifyError}`);
      }

      // Atomic move: rename temp file to final cache file
      await this.executeFileOperationWithRetry(
        async () => {
          // Remove old cache if it exists
          const exists = await this.vault.adapter.exists(this.cacheFilePath);
          if (exists) {
            await this.vault.adapter.remove(this.cacheFilePath);
          }
          // Copy temp to final location (some adapters don't support rename)
          await this.vault.adapter.write(this.cacheFilePath, tempContent as string);
          // Remove temp file
          await this.vault.adapter.remove(tempCachePath);
        },
        'Cache atomic move operation'
      );

      logIfDebugModeEnabled(`Bloom filter cache saved: ${Object.keys(cache.filters).length} documents`);
      this.cacheDirty = false;
      this.cacheReady = true;
      return true;
    } catch (error) {
      handleCacheError(error as Error, 'save cache', { cacheFilePath: this.cacheFilePath });
      
      // Cleanup temp file on error
      try {
        const tempCachePath = `${this.cacheFilePath}.tmp`;
        await this.vault.adapter.remove(tempCachePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      return false;
    } finally {
      this.isSaving = false;
    }
  }

  /**
   * Load the bloom filter index from disk cache
   */
  private async loadFromCache(): Promise<boolean> {
    if (!this.cacheFilePath || !this.vault.adapter) {
      // Cannot load cache: no cache path or vault adapter
      return false;
    }

    try {
      // Check if cache file exists with retry logic
      const exists = await this.executeFileOperationWithRetry(
        () => this.vault.adapter.exists(this.cacheFilePath),
        'Cache existence check'
      );
      if (!exists) {
        // Cache file does not exist
        return false;
      }

      // Read cache file with retry logic
      const cacheData = await this.executeFileOperationWithRetry(
        () => this.vault.adapter.read(this.cacheFilePath),
        'Cache read operation'
      );

      // Parse the JSON with error handling
      let cache;
      try {
        cache = JSON.parse(cacheData as string);
      } catch (error) {
        // Cache file contains invalid JSON, deleting corrupt cache
        this.deleteCache();
        return false;
      }

      // Enhanced cache validation
      const validationResult = this.validateCacheStructure(cache);
      if (!validationResult.isValid) {
        console.error('Cache validation failed:', validationResult.reason);
        this.deleteCache();
        return false;
      }

      // Validate parameters match - check compatibility
      const params = cache.params;
      
      // Check for critical parameter mismatches that would cause errors
      if (!this.areArraysEqual(params.ngramSizes, this.ngramSizes) ||
        !this.areArraysEqual(params.hashFunctions, this.hashFunctions)) {
        logIfDebugModeEnabled('Cache parameter mismatch detected, will rebuild index');
        this.deleteCache(); // Delete the incompatible cache file
        return false;
      }
      
      // Check for bloom size mismatches (less critical, but can cause errors)
      if (params.bloomSizes && !this.areArraysEqual(params.bloomSizes, this.bloomSizes)) {
        logIfDebugModeEnabled('Bloom filter size mismatch detected, will rebuild index');
        this.deleteCache(); // Delete the incompatible cache file
        return false;
      }
      
      // Similarity threshold changes are ok - we can work with different thresholds
      if (params.similarityThreshold !== this.similarityThreshold) {
        logIfDebugModeEnabled(`Similarity threshold changed from ${params.similarityThreshold} to ${this.similarityThreshold}, continuing with cache`);
      }

      // Verify all bloom filters have the same size
      const bloomSizes = cache.params.bloomSizes;
      if (bloomSizes && Array.isArray(bloomSizes) && bloomSizes.length > 0) {
        const firstSize = bloomSizes[0];
        const allSame = bloomSizes.every((size: number) => size === firstSize);
        if (!allSame) {
          // Cache contains bloom filters with different sizes, clearing invalid cache
          this.deleteCache(); // Delete the invalid cache file
          return false;
        }
      }

      // Clear existing data
      this.bloomFilters.clear();
      this.documentNgrams.clear();
      this.commonWords.clear();

      // Load common words
      if (cache.commonWords && Array.isArray(cache.commonWords)) {
        for (const word of cache.commonWords) {
          this.commonWords.add(word);
        }
        this.commonWordsComputed = true;
        // Loaded common words from cache
      }

      // Load documents count
      if (cache.stats && cache.stats.totalDocuments) {
        this.totalDocuments = cache.stats.totalDocuments;
      }

      // Load bloom filters
      let loadedCount = 0;
      for (const [docId, rawFilterData] of Object.entries(cache.filters)) {
        try {
          // Type guard - make sure filterData is an object
          if (!rawFilterData || typeof rawFilterData !== 'object') {
            // Invalid filter data, skipping
            continue;
          }

          const filterData = rawFilterData as {
            ngramSizes?: number[],
            [key: string]: any
          };

          // Create a new multi-resolution bloom filter
          const ngramSizes = Array.isArray(filterData.ngramSizes) ? filterData.ngramSizes : this.ngramSizes;
          const filter = new SingleBloomFilter(
            ngramSizes,
            this.bloomSizes,
            this.hashFunctions
          );

          // For each n-gram size, restore the bloom filter's bit array
          for (const ngramSize of ngramSizes) {
            const bitArrayKey = `bloom_${ngramSize}`;
            if (filterData[bitArrayKey] && Array.isArray(filterData[bitArrayKey])) {
              const bloomFilter = filter.filters.get(ngramSize);
              if (bloomFilter) {
                // Convert array back to Uint32Array
                const bitArray = new Uint32Array(filterData[bitArrayKey]);
                // Use the setter method to set the bit array
                bloomFilter.setBitArray(bitArray);
              }
            }
          }

          this.bloomFilters.set(docId, filter);
          loadedCount++;
        } catch (error) {
          console.error(`Error restoring bloom filter for ${docId}:`, error);
          
          // Check if this is a size mismatch error (cache incompatibility)
          if (error instanceof Error && error.message.includes('Array length mismatch')) {
            logIfDebugModeEnabled(`Cache format incompatibility detected for ${docId}, will rebuild index`);
            // Clear the problematic cache entry
            if (cache.filters && cache.filters[docId]) {
              delete cache.filters[docId];
            }
          }
          
          // Continue with other filters - don't let one bad entry break everything
          continue;
        }
      }

      // Successfully loaded bloom filters from cache
      this.cacheDirty = false;
      this.cacheReady = true;
      return loadedCount > 0;
    } catch (error) {
      console.error('Error loading bloom filter cache:', error);
      return false;
    }
  }

  /**
   * Helper method to compare arrays for equality
   */
  private areArraysEqual(a: any[], b: any[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * Manually save the cache to disk
   * This can be called externally to ensure the cache is saved
   */
  async saveCache(): Promise<boolean> {
    return this.saveToCache();
  }

  /**
   * Validate and normalize the config directory path
   * @param configDir The config directory path to validate
   * @returns Normalized config directory path
   * @throws Error if the path is invalid
   */
  private validateConfigDir(configDir: string): string {
    if (!configDir || typeof configDir !== 'string') {
      throw new Error('Config directory path is invalid or not provided');
    }

    // Remove any trailing slashes for consistency
    const normalizedPath = configDir.replace(/\/+$/, '');

    // Basic path validation - check for suspicious patterns
    if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
      throw new Error('Config directory path contains invalid patterns');
    }

    // Check if path is too short (should be at least a few characters)
    if (normalizedPath.length < 3) {
      throw new Error('Config directory path is too short to be valid');
    }

    return normalizedPath;
  }

  /**
   * Validate cache directory exists and is writable
   * @returns Promise<boolean> indicating if cache directory is accessible
   */
  private async validateCacheDirectory(): Promise<boolean> {
    if (!this.cacheFilePath || !this.vault.adapter) {
      return false;
    }

    try {
      const cacheDir = this.cacheFilePath.substring(0, this.cacheFilePath.lastIndexOf('/'));

      // Check if directory exists
      const dirExists = await this.vault.adapter.exists(cacheDir);
      if (!dirExists) {
        // Try to create the directory
        await this.vault.adapter.mkdir(cacheDir);
        logIfDebugModeEnabled(`Created cache directory: ${cacheDir}`);
      }

      // Test write access by creating a temporary file
      const testFilePath = `${cacheDir}/.write-test-${Date.now()}`;
      try {
        await this.vault.adapter.write(testFilePath, 'test');
        await this.vault.adapter.remove(testFilePath);
        return true;
      } catch (writeError) {
        console.error('Cache directory is not writable:', writeError);
        return false;
      }
    } catch (error) {
      console.error('Failed to validate cache directory:', error);
      return false;
    }
  }

  /**
   * Validate cache structure and content
   * @param cache The cache object to validate
   * @returns Validation result with success status and reason
   */
  private validateCacheStructure(cache: any): { isValid: boolean; reason?: string } {
    // Check if cache is an object
    if (!cache || typeof cache !== 'object') {
      return { isValid: false, reason: 'Cache is not a valid object' };
    }

    // Check version
    if (!cache.version || typeof cache.version !== 'number') {
      return { isValid: false, reason: 'Cache version is missing or invalid' };
    }

    if (cache.version !== CACHE.VERSION) {
      return { isValid: false, reason: `Cache version mismatch: expected ${CACHE.VERSION}, got ${cache.version}` };
    }

    // Check required top-level properties
    const requiredProperties = ['params', 'filters', 'stats', 'timestamp'];
    for (const prop of requiredProperties) {
      if (!(prop in cache)) {
        return { isValid: false, reason: `Missing required property: ${prop}` };
      }
    }

    // Validate params structure
    if (!cache.params || typeof cache.params !== 'object') {
      return { isValid: false, reason: 'Cache params is missing or invalid' };
    }

    const requiredParams = ['ngramSizes', 'hashFunctions', 'similarityThreshold'];
    for (const param of requiredParams) {
      if (!(param in cache.params)) {
        return { isValid: false, reason: `Missing required param: ${param}` };
      }
    }

    // Validate filters structure
    if (!cache.filters || typeof cache.filters !== 'object') {
      return { isValid: false, reason: 'Cache filters is missing or invalid' };
    }

    // Validate stats structure
    if (!cache.stats || typeof cache.stats !== 'object') {
      return { isValid: false, reason: 'Cache stats is missing or invalid' };
    }

    // Check cache age (reject if too old)
    if (typeof cache.timestamp === 'number') {
      const cacheAge = Date.now() - cache.timestamp;
      if (cacheAge > TIMING.CACHE_AGE_THRESHOLD_MS) {
        return { isValid: false, reason: `Cache is too old: ${Math.round(cacheAge / (24 * 60 * 60 * 1000))} days` };
      }
    }

    return { isValid: true };
  }

  /**
   * Execute file operation with timeout and retry logic
   * @param operation The file operation to execute
   * @param operationName Description of the operation for logging
   * @param maxRetries Maximum number of retry attempts
   * @param timeoutMs Timeout in milliseconds for each attempt
   * @returns Promise that resolves to operation result
   */
  private async executeFileOperationWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    maxRetries: number = FILE_OPERATIONS.MAX_RETRIES,
    timeoutMs: number = FILE_OPERATIONS.TIMEOUT_MS
  ): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`${operationName} timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        // Race between operation and timeout
        const result = await Promise.race([
          operation(),
          timeoutPromise
        ]);

        return result;
      } catch (error) {
        handleFileError(error as Error, operationName, `attempt ${attempt}/${maxRetries}`);

        if (attempt === maxRetries) {
          throw new Error(`${operationName} failed after ${maxRetries} attempts: ${error}`);
        }

        // Exponential backoff: wait longer between retries
        const backoffMs = Math.min(FILE_OPERATIONS.BASE_BACKOFF_MS * Math.pow(2, attempt - 1), FILE_OPERATIONS.MAX_BACKOFF_MS);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Unexpected error in ${operationName}`);
  }

  /**
   * Smart text truncation that preserves complete words and sentences
   * @param text The text to truncate
   * @param maxLength Maximum character length
   * @returns Truncated text that preserves word/sentence boundaries
   */
  private smartTruncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
      return text;
    }

    // Try to truncate at sentence boundaries first
    const sentenceEnds = /[.!?]+\s+/g;
    let lastSentenceEnd = 0;
    let match;

    while ((match = sentenceEnds.exec(text)) !== null) {
      if (match.index + match[0].length > maxLength) {
        break;
      }
      lastSentenceEnd = match.index + match[0].length;
    }

    // If we found a good sentence boundary within 80% of the limit, use it
    if (lastSentenceEnd > maxLength * TEXT_PROCESSING.SENTENCE_BOUNDARY_RATIO) {
      return text.substring(0, lastSentenceEnd);
    }

    // Otherwise, truncate at word boundaries
    const wordBoundary = /\s+/g;
    let lastWordEnd = 0;
    let wordMatch;

    while ((wordMatch = wordBoundary.exec(text)) !== null) {
      if (wordMatch.index > maxLength) {
        break;
      }
      lastWordEnd = wordMatch.index;
    }

    // If we found a good word boundary within 90% of the limit, use it
    if (lastWordEnd > maxLength * TEXT_PROCESSING.WORD_BOUNDARY_RATIO) {
      return text.substring(0, lastWordEnd);
    }

    // Fallback to character-based truncation, but avoid breaking mid-word
    let truncateIndex = maxLength;
    while (truncateIndex > maxLength * TEXT_PROCESSING.TRUNCATION_FALLBACK_RATIO &&
      truncateIndex < text.length &&
      /\S/.test(text[truncateIndex])) {
      truncateIndex--;
    }

    return text.substring(0, truncateIndex);
  }

  /**
   * Deletes the cache file from disk
   * Used when cache is detected to be invalid
   */
  private async deleteCache(): Promise<void> {
    if (!this.cacheFilePath || !this.vault.adapter) {
      logIfDebugModeEnabled('Cannot delete cache: no cache path or vault adapter');
      return;
    }

    try {
      // Check if cache file exists with retry logic
      const exists = await this.executeFileOperationWithRetry(
        () => this.vault.adapter.exists(this.cacheFilePath),
        'Cache deletion check'
      );
      if (exists) {
        // Delete the file with retry logic
        await this.executeFileOperationWithRetry(
          () => this.vault.adapter.remove(this.cacheFilePath),
          'Cache deletion operation'
        );
        // Deleted invalid cache file
      }
    } catch (error) {
      console.error('Error deleting cache file:', error);
    }
  }
}