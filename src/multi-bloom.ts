/**
 * @file Multi-resolution bloom filter implementation for the Related Notes plugin.
 * Uses multiple bloom filters with different n-gram sizes for better accuracy.
 */

'use strict';

import { tokenize } from './core';
import { BloomFilter } from './bloom';

// Logger for multi-bloom filter operations
const DEBUG_MODE = true;

function log(...args: any[]) {
  if (DEBUG_MODE) {
    console.log('[MultiBloom]', ...args);
  }
}

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
 * Multi-resolution bloom filter that uses multiple n-gram sizes
 * This provides better accuracy by capturing both fine and coarse-grained features
 */
export class MultiResolutionBloomFilter {
  // Bloom filters for different n-gram sizes
  private readonly filters: Map<number, BloomFilter> = new Map();
  // Weights for each n-gram size (higher weights give more importance)
  private readonly weights: Map<number, number> = new Map();
  // Configuration
  private readonly ngramSizes: number[];
  private readonly bloomSizes: number[];
  private readonly hashFunctionCounts: number[];
  // Statistics
  private readonly addedItems = new Set<string>();
  private readonly itemCounts = new Map<number, number>();
  
  /**
   * Creates a new multi-resolution bloom filter
   * @param ngramSizes Array of n-gram sizes to use (e.g., [2, 3, 4])
   * @param bloomSizes Array of bloom filter sizes for each n-gram size
   * @param hashFunctions Array of hash function counts for each n-gram size
   * @param weights Array of weights for each n-gram size (higher gives more importance)
   */
  constructor(
    ngramSizes: number[] = [2, 3, 4],
    bloomSizes?: number[],
    hashFunctions?: number[],
    weights?: number[]
  ) {
    this.ngramSizes = ngramSizes;
    
    // Calculate default sizes and hash function counts if not provided
    const defaultSize = 256;
    const defaultHashFunctions = 3;
    
    this.bloomSizes = bloomSizes || ngramSizes.map(() => defaultSize);
    this.hashFunctionCounts = hashFunctions || ngramSizes.map(() => defaultHashFunctions);
    
    // Create bloom filters for each n-gram size
    for (let i = 0; i < ngramSizes.length; i++) {
      const ngramSize = ngramSizes[i];
      const bloomSize = this.bloomSizes[i];
      const hashCount = this.hashFunctionCounts[i];
      
      this.filters.set(ngramSize, new BloomFilter(bloomSize, hashCount));
      this.itemCounts.set(ngramSize, 0);
    }
    
    // Set weights (default: equal weights)
    if (weights && weights.length === ngramSizes.length) {
      for (let i = 0; i < ngramSizes.length; i++) {
        this.weights.set(ngramSizes[i], weights[i]);
      }
    } else {
      // Default: higher weight for middle n-gram sizes
      const totalSizes = ngramSizes.length;
      for (let i = 0; i < totalSizes; i++) {
        // Bell curve weighting: higher weights for middle values
        // For [2,3,4], weights are approximately [0.3, 0.4, 0.3]
        const position = i / (totalSizes - 1); // 0 to 1
        const weight = Math.exp(-Math.pow((position - 0.5) * 2, 2));
        this.weights.set(ngramSizes[i], weight);
      }
    }
    
    // Normalize weights to sum to 1
    const totalWeight = Array.from(this.weights.values()).reduce((sum, w) => sum + w, 0);
    for (const [size, weight] of this.weights.entries()) {
      this.weights.set(size, weight / totalWeight);
    }
    
    log(`Created MultiResolutionBloomFilter with ${ngramSizes.length} resolutions:`);
    for (let i = 0; i < ngramSizes.length; i++) {
      log(`  - n-gram size ${ngramSizes[i]}: ${this.bloomSizes[i]} bits, ${this.hashFunctionCounts[i]} hash functions, weight ${this.weights.get(ngramSizes[i])?.toFixed(2)}`);
    }
  }
  
  /**
   * Add text to the multi-resolution bloom filter
   * @param text The text to add
   */
  addText(text: string): void {
    this.addedItems.add(text);
    
    // Generate n-grams for each size and add to corresponding filter
    for (const ngramSize of this.ngramSizes) {
      const ngrams = this.extractNgrams(text, ngramSize);
      const filter = this.filters.get(ngramSize);
      
      if (!filter) continue;
      
      let count = 0;
      for (const ngram of ngrams) {
        filter.add(ngram);
        count++;
      }
      
      this.itemCounts.set(ngramSize, (this.itemCounts.get(ngramSize) || 0) + count);
      
      if (DEBUG_MODE) {
        log(`Added ${ngrams.size} ${ngramSize}-grams to filter`);
      }
    }
  }
  
  /**
   * Calculate similarity between this filter and another
   * @param other The other multi-resolution filter
   * @returns Weighted similarity score (0-1)
   */
  similarity(other: MultiResolutionBloomFilter): number {
    let totalSimilarity = 0;
    let totalWeight = 0;
    
    // Calculate similarity for each n-gram size and apply weights
    for (const ngramSize of this.ngramSizes) {
      const thisFilter = this.filters.get(ngramSize);
      const otherFilter = other.filters.get(ngramSize);
      const weight = this.weights.get(ngramSize) || 0;
      
      if (!thisFilter || !otherFilter) continue;
      
      const similarity = thisFilter.similarity(otherFilter);
      totalSimilarity += similarity * weight;
      totalWeight += weight;
      
      if (DEBUG_MODE) {
        log(`${ngramSize}-gram similarity: ${(similarity * 100).toFixed(2)}% (weight: ${weight.toFixed(2)})`);
      }
    }
    
    // Normalize by total weight
    const weightedSimilarity = totalWeight > 0 ? totalSimilarity / totalWeight : 0;
    
    if (DEBUG_MODE) {
      log(`Weighted similarity: ${(weightedSimilarity * 100).toFixed(2)}%`);
    }
    
    return weightedSimilarity;
  }
  
  /**
   * Extract n-grams from text
   * @param text Input text
   * @param ngramSize Size of n-grams to extract
   * @returns Set of n-grams
   */
  private extractNgrams(text: string, ngramSize: number): Set<string> {
    // Use the tokenize function to normalize text
    const processed = tokenize(text);
    const ngrams = new Set<string>();
    
    // Prepare text by removing extra spaces
    // Use a Unicode-aware normalization to ensure consistent handling across languages
    const chars = processed.toLowerCase().normalize('NFC').replace(/\s+/g, ' ');
    
    // Extract character n-grams with Unicode awareness
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
   * Get statistics about the multi-resolution bloom filter
   */
  getStats(): any {
    const stats: any = {
      resolutions: this.ngramSizes.length,
      ngramSizes: this.ngramSizes,
      totalMemoryBytes: 0,
      itemCounts: {},
      weights: {},
      saturation: {}
    };
    
    // Collect stats for each resolution
    for (const ngramSize of this.ngramSizes) {
      const filter = this.filters.get(ngramSize);
      if (!filter) continue;
      
      const size = filter.getSize();
      const hashFunctions = filter.getHashFunctions();
      const itemCount = this.itemCounts.get(ngramSize) || 0;
      const weight = this.weights.get(ngramSize) || 0;
      const memoryBytes = size / 8;
      
      stats.totalMemoryBytes += memoryBytes;
      stats.itemCounts[ngramSize] = itemCount;
      stats.weights[ngramSize] = weight;
      stats.saturation[ngramSize] = filter.getFalsePositiveRate();
    }
    
    return stats;
  }
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
      // Default n-gram sizes for small corpora
      return [2, 3, 4];
    }
    
    // Calculate average word length
    const avgWordLength = this.averageDocLength > 0 ? 
      this.averageDocLength / this.averageVocabularySize : 5;
    
    // Choose n-gram sizes based on average word length
    if (avgWordLength < 4) {
      // Short words: use smaller n-grams
      return [2, 3];
    } else if (avgWordLength < 6) {
      // Medium words: use standard n-grams
      return [2, 3, 4];
    } else {
      // Long words: use larger n-grams
      return [3, 4, 5];
    }
  }
  
  /**
   * Calculate optimal bloom filter sizes based on vocabulary size
   * @param ngramSizes Array of n-gram sizes
   * @param falsePositiveRate Desired false positive rate (default: 0.01)
   * @returns Array of recommended bloom filter sizes
   */
  calculateOptimalBloomSizes(ngramSizes: number[], falsePositiveRate: number = 0.01): number[] {
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
  }
  
  /**
   * Calculate optimal hash function counts
   * @param bloomSizes Array of bloom filter sizes
   * @param ngramSizes Array of n-gram sizes
   * @returns Array of recommended hash function counts
   */
  calculateOptimalHashFunctions(bloomSizes: number[], ngramSizes: number[]): number[] {
    if (this.documentsAnalyzed < 10) {
      // Default hash function counts for small corpora
      return ngramSizes.map(() => 3);
    }
    
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
    if (this.documentsAnalyzed < 10) {
      // Default threshold for small corpora
      return 0.3;
    }
    
    // Calculate coefficient of variation for document lengths
    const meanDocLength = this.averageDocLength;
    const variance = this.documentLengths.reduce(
      (sum, len) => sum + Math.pow(len - meanDocLength, 2), 0
    ) / this.documentsAnalyzed;
    const stdDev = Math.sqrt(variance);
    const cv = stdDev / meanDocLength;
    
    // Adjust threshold based on corpus homogeneity
    if (cv < 0.3) {
      // Very homogeneous corpus: higher threshold
      return 0.4;
    } else if (cv < 0.6) {
      // Moderately varied corpus: medium threshold
      return 0.3;
    } else {
      // Highly varied corpus: lower threshold
      return 0.2;
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
export class MultiResolutionBloomFilterProvider {
  private readonly bloomFilters = new Map<string, MultiResolutionBloomFilter>();
  private readonly documentNgrams = new Map<string, Map<number, Set<string>>>();
  private readonly config: any;
  private readonly parameterCalculator = new AdaptiveParameterCalculator();
  private ngramSizes: number[];
  private bloomSizes: number[];
  private hashFunctions: number[];
  private similarityThreshold: number;
  private adaptiveParameters = false;
  private parameterUpdateInterval = 100; // Update parameters every 100 documents
  private documentsProcessed = 0;
  private vault: any;
  private onProgressCallback: ((progress: number) => void) | null = null;
  private stopRequested = false;
  private isInitialized = false;
  
  // Required properties for SimilarityProvider interface
  public isCorpusSampled = false;
  public onDemandComputationEnabled = true;
  
  // Adaptive stopwords (reusing from BloomFilterSimilarityProvider)
  private readonly wordFrequencies = new Map<string, number>();
  private readonly wordDocumentCount = new Map<string, Set<string>>();
  private readonly commonWords = new Set<string>();
  private totalDocuments = 0;
  private commonWordsThreshold = 0.5;
  private commonWordsComputed = false;
  private minWordLength = 2;
  private maxStopwords = 200;
  
  constructor(vault: any, config: any = {}) {
    this.vault = vault;
    this.config = config;
    
    // Initialize with default parameters
    this.ngramSizes = config.ngramSizes || [2, 3, 4];
    this.bloomSizes = config.bloomSizes || this.ngramSizes.map(() => 256);
    this.hashFunctions = config.hashFunctions || this.ngramSizes.map(() => 3);
    this.similarityThreshold = config.similarityThreshold || 0.3;
    
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
    
    // Set interface properties
    this.onDemandComputationEnabled = config.onDemandComputationEnabled !== false;
    
    log(`Created MultiResolutionBloomFilterProvider with:
      - n-gram sizes: [${this.ngramSizes.join(', ')}]
      - bloom sizes: [${this.bloomSizes.join(', ')}]
      - hash functions: [${this.hashFunctions.join(', ')}]
      - similarity threshold: ${this.similarityThreshold}
      - adaptive parameters: ${this.adaptiveParameters}
      - parameter update interval: ${this.parameterUpdateInterval} documents
      - adaptive stopwords: true (max: ${this.maxStopwords}, threshold: ${this.commonWordsThreshold * 100}%)
      - on-demand computation: ${this.onDemandComputationEnabled}`);
  }
  
  /**
   * Initialize the similarity provider by processing all markdown files
   * @param onProgress Callback function for reporting progress
   */
  async initialize(onProgress?: (processed: number, total: number) => void): Promise<void> {
    if (this.isInitialized) return;
    
    this.stopRequested = false;
    
    try {
      // Get all markdown files
      const markdownFiles = this.vault.getMarkdownFiles();
      const totalFiles = markdownFiles.length;
      log(`Initializing with ${totalFiles} markdown files`);
      
      // Process files in batches
      const batchSize = this.config.batchSize || 10;
      let processedCount = 0;
      
      // Custom progress callback wrapper that adapts the signature
      const progressCallback = (processed: number, total: number) => {
        if (onProgress) {
          onProgress(processed, total);
        }
      };
      
      for (let i = 0; i < totalFiles; i += batchSize) {
        if (this.stopRequested) {
          log('Initialization stopped by user');
          break;
        }
        
        const batch = markdownFiles.slice(i, i + batchSize);
        
        // Process each file in the batch
        await Promise.all(batch.map(async (file: any) => {
          try {
            const content = await this.vault.cachedRead(file);
            this.processDocument(file.path, content);
          } catch (error) {
            console.error(`Error processing file ${file.path}:`, error);
          }
        }));
        
        // Update processed count and report progress
        processedCount += batch.length;
        progressCallback(processedCount, totalFiles);
      }
      
      log(`Initialization complete: processed ${this.bloomFilters.size} files`);
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
  }
  
  /**
   * Force a complete reindexing of all files
   * @param onProgress Progress callback
   */
  async forceReindex(onProgress: (processed: number, total: number) => void): Promise<void> {
    // Clear existing data
    this.bloomFilters.clear();
    this.documentNgrams.clear();
    
    // Reset stopwords detection
    this.commonWords.clear();
    this.commonWordsComputed = false;
    this.totalDocuments = 0;
    
    // Reinitialize
    this.isInitialized = false;
    return this.initialize(onProgress);
  }
  
  /**
   * Check if a file is indexed
   * @param file File to check
   */
  isFileIndexed(file: any): boolean {
    return this.bloomFilters.has(file.path);
  }
  
  /**
   * Compute related notes on demand for a file
   * @param file File to find related notes for
   */
  async computeRelatedNotesOnDemand(file: any): Promise<any[]> {
    if (!this.isInitialized) {
      return [];
    }
    
    try {
      // Process the file if not already indexed
      if (!this.bloomFilters.has(file.path)) {
        const content = await this.vault.cachedRead(file);
        this.processDocument(file.path, content);
      }
      
      // Get candidate files
      return this.getCandidateFiles(file);
    } catch (error) {
      console.error(`Error computing related notes for ${file.path}:`, error);
      return [];
    }
  }
  
  /**
   * Get candidate similar files for a given file
   * Implements the SimilarityProvider interface
   * @param file The file to find candidates for
   * @returns Array of potential similar files
   */
  getCandidateFiles(file: any): any[] {
    if (!this.isInitialized) {
      return [];
    }
    
    try {
      // Get similar documents - if the file isn't in our index yet,
      // we'll handle that in computeCappedCosineSimilarity
      if (!this.bloomFilters.has(file.path)) {
        return []; // Return empty for now, we'll handle this on-demand
      }
      
      // Get similar documents
      const similarDocuments = this.getSimilarDocuments(
        file.path, 
        this.config.maxSuggestions || 10,
        this.similarityThreshold
      );
      
      // Convert paths to files
      const markdownFiles = this.vault.getMarkdownFiles();
      const pathToFile = new Map<string, any>();
      
      for (const mdFile of markdownFiles) {
        pathToFile.set(mdFile.path, mdFile);
      }
      
      // Return the files with their similarity scores
      return similarDocuments
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
   * @returns Similarity info with score
   */
  async computeCappedCosineSimilarity(file1: any, file2: any): Promise<{ similarity: number }> {
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
      return { similarity };
    } catch (error) {
      console.error(`Error computing similarity between ${file1.path} and ${file2.path}:`, error);
      return { similarity: 0 };
    }
  }
  
  /**
   * Process a document and create bloom filters
   * @param docId Document identifier
   * @param text Document text
   */
  processDocument(docId: string, text: string): void {
    const startTime = performance.now();
    
    // Analyze document for parameter optimization
    if (this.adaptiveParameters) {
      this.parameterCalculator.analyzeDocument(text);
    }
    
    // Track word frequencies for adaptive stopwords
    this.trackWordFrequencies(docId, text);
    
    // Update parameters periodically if adaptive
    this.documentsProcessed++;
    if (this.adaptiveParameters && this.documentsProcessed % this.parameterUpdateInterval === 0) {
      this.updateParameters();
    }
    
    // Compute common words if enough documents have been processed
    if (this.totalDocuments >= 100 && !this.commonWordsComputed) {
      this.computeCommonWords();
    }
    
    // Create multi-resolution bloom filter
    const filter = new MultiResolutionBloomFilter(
      this.ngramSizes,
      this.bloomSizes,
      this.hashFunctions
    );
    
    // Process text with stopwords filtering
    const processed = this.preprocessText(text);
    filter.addText(processed);
    
    // Store the filter
    this.bloomFilters.set(docId, filter);
    
    const endTime = performance.now();
    
    if (DEBUG_MODE) {
      log(`Processed document ${docId} in ${(endTime - startTime).toFixed(2)}ms`);
    }
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
      if (DEBUG_MODE) {
        if (!filter1) log(`Document ${docId1} not found`);
        if (!filter2) log(`Document ${docId2} not found`);
      }
      return 0;
    }
    
    // Calculate the multi-resolution similarity
    const similarity = filter1.similarity(filter2);
    
    const endTime = performance.now();
    
    if (DEBUG_MODE) {
      log(`Similarity calculation for ${docId1} and ${docId2}: ${(similarity * 100).toFixed(2)}% in ${(endTime - startTime).toFixed(2)}ms`);
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
    threshold?: number
  ): [string, number][] {
    // Use provided threshold or the current adaptive one
    const actualThreshold = threshold || this.similarityThreshold;
    const startTime = performance.now();
    
    // Get the filter for the query document
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
      
      if (similarity >= actualThreshold) {
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
        - Threshold: ${actualThreshold}
        - Time: ${(endTime - startTime).toFixed(2)}ms`);
    }
    
    return sortedResults;
  }
  
  /**
   * Update parameters based on corpus analysis
   */
  private updateParameters(): void {
    if (!this.adaptiveParameters || this.documentsProcessed < 50) return;
    
    const params = this.parameterCalculator.generateRecommendedParameters();
    
    // Log changes to parameters
    if (DEBUG_MODE) {
      log(`Updating parameters after analyzing ${this.documentsProcessed} documents:
        - n-gram sizes: [${this.ngramSizes.join(', ')}] -> [${params.ngramSizes.join(', ')}]
        - bloom sizes: [${this.bloomSizes.join(', ')}] -> [${params.bloomSizes.join(', ')}]
        - hash functions: [${this.hashFunctions.join(', ')}] -> [${params.hashFunctions.join(', ')}]
        - similarity threshold: ${this.similarityThreshold} -> ${params.similarityThreshold}`);
    }
    
    // Update parameters
    this.ngramSizes = params.ngramSizes;
    this.bloomSizes = params.bloomSizes;
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
    
    // Use the tokenize function from core
    const processed = tokenize(text);
    
    // Get unique words from the document
    const words = processed.toLowerCase().split(/\s+/);
    const uniqueWords = new Set<string>();
    
    // Count word frequencies
    for (const word of words) {
      if (word.length <= this.minWordLength) continue; // Skip very short words
      
      // Update overall word frequency
      this.wordFrequencies.set(word, (this.wordFrequencies.get(word) || 0) + 1);
      
      // Track unique words in this document
      uniqueWords.add(word);
    }
    
    // Track which documents each word appears in
    for (const word of uniqueWords) {
      if (!this.wordDocumentCount.has(word)) {
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
    
    if (DEBUG_MODE) {
      log(`Computed ${this.commonWords.size} common words from ${this.totalDocuments} documents`);
      
      if (this.commonWords.size <= 50) {
        log(`Common words: ${Array.from(this.commonWords).join(', ')}`);
      } else {
        log(`Top 50 common words: ${Array.from(this.commonWords).slice(0, 50).join(', ')}...`);
      }
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
   * Clear all bloom filters
   */
  clear(): void {
    this.bloomFilters.clear();
    this.documentNgrams.clear();
  }
  
  /**
   * Get the number of documents indexed
   */
  size(): number {
    return this.bloomFilters.size;
  }
}