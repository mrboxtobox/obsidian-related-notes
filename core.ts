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
}

export interface SimilarityInfo {
  similarity: number;
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

export function tokenize(text: string): string {
  if (!text) return '';

  const stopWords = new Set([
    'a', 'an', 'the', 'in', 'on', 'at', 'with', 'by', 'from', 'up', 'about',
    'into', 'over', 'after', 'and', 'but', 'or', 'so', 'am', 'is', 'are',
    'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did'
  ]);

  const contractions = new Map([
    ["n't", " not"], ["'re", " are"], ["'s", " is"],
    ["'d", " would"], ["'ll", " will"], ["'ve", " have"]
  ]);

  try {
    // Replace contractions
    let processed = text.replace(
      new RegExp(Object.keys(contractions).join('|'), 'g'),
      match => contractions.get(match) || match
    );

    return processed
      .toLowerCase()
      // Remove special characters and extra spaces
      .replace(/[^\w\s-]/g, ' ')
      .split(/\s+/)
      // Filter stop words and short terms
      .filter(word => word.length > 2 && !stopWords.has(word))
      .join(' ');
  } catch (error) {
    console.error('Error during tokenization:', error);
    return '';
  }
}

export class SimilarityProviderV2 implements SimilarityProvider {
  private async yieldToMain(count: number, batchSize: number): Promise<void> {
    if (count % batchSize === 0) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
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

  constructor(
    private readonly vault: Vault,
    private readonly config = {
      numBands: 5,
      rowsPerBand: 2,
      shingleSize: 2,
      batchSize: 1,
      maxFiles: 5000,
      cacheFilePath: '.obsidian/plugins/obsidian-related-notes/similarity-cache.json',
      // Adaptive parameters for large corpora
      largeBands: 8,       // More bands for large corpora = more candidates
      largeRowsPerBand: 1, // Fewer rows per band = more lenient matching
      largeCorpusThreshold: 1000, // When to consider a corpus "large"
      minSimilarityThreshold: 0.15 // Lower threshold for large corpora
    }
  ) {
    // Dynamically adjust LSH parameters based on corpus size
    const signatureSize = config.numBands * config.rowsPerBand;
    if (signatureSize % config.numBands !== 0) {
      throw new Error('Signature size must be divisible by number of bands');
    }
  }

  getCandidateFiles(file: TFile): TFile[] {
    return this.relatedNotes.get(file.name) || [];
  }

  isCorpusSampled(): boolean {
    return this.isCorpusTruncated;
  }

  private shuffleArray(array: number[]): void {
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

      if (changedFiles.length === 0 || (changedPercentage < this.driftThreshold && Date.now() - this.lastCacheUpdate < this.cacheUpdateInterval)) {
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

  private async buildVocabularyAndVectors(onProgress?: (processed: number, total: number) => void): Promise<void> {
    const allFiles = this.vault.getMarkdownFiles();
    for (const file of allFiles) {
      this.nameToTFile.set(file.name, file);
    }

    let processedCount = 0;
    const filesToProcess = allFiles.slice(0, this.config.maxFiles);
    const totalFiles = filesToProcess.length;
    this.isCorpusTruncated = allFiles.length > this.config.maxFiles;

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
      // await this.yieldToMain(count, this.config.batchSize);
    }
  }

  private async createSignature(shingles: Set<string>): Promise<number[]> {
    const signature: number[] = [];

    for (const hashFunc of this.minhashFunctions) {
      for (let i = 1; i <= this.vocabulary.length; i++) {
        const idx = hashFunc.indexOf(i);
        const shingle = this.vocabulary[idx];
        if (shingles.has(shingle)) {
          signature.push(idx);
          break;
        }
      }
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
      // await this.yieldToMain(count, this.config.batchSize);
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

  async computeCappedCosineSimilarity(
    file1: TFile,
    file2: TFile
  ): Promise<SimilarityInfo> {
    // Determine if we're dealing with a large corpus
    const isLargeCorpus = this.fileVectors.size >= this.config.largeCorpusThreshold;

    // Adjust similarity threshold based on corpus size
    const effectiveThreshold = isLargeCorpus
      ? this.config.minSimilarityThreshold
      : this.similarityThreshold;

    // Check if we have cached vectors for both files
    const vector1 = this.fileVectors.get(file1.name);
    const vector2 = this.fileVectors.get(file2.name);

    if (vector1 && vector2) {
      // Use cached vectors for faster similarity computation
      const result = this.calculateJaccardSimilarity(vector1, vector2);

      // Apply adaptive threshold for large corpora
      if (isLargeCorpus && result.similarity > 0) {
        // Boost similarity for large corpora to ensure we get results
        // This helps show approximate matches that would otherwise be filtered out
        const boostedSimilarity = Math.min(1, result.similarity * 1.2);
        return { similarity: boostedSimilarity };
      }

      return result;
    }

    // Fall back to full computation if vectors not cached
    try {
      const [content1, content2] = await Promise.all([
        this.vault.cachedRead(file1),
        this.vault.cachedRead(file2)
      ]);

      // Use more efficient tokenization with fewer tokens
      const tokens1 = tokenize(content1).split(' ');
      const tokens2 = tokenize(content2).split(' ');

      const freqMap1 = this.buildFrequencyMap(tokens1);
      const freqMap2 = this.buildFrequencyMap(tokens2);

      const result = this.calculateCosineSimilarity(freqMap1, freqMap2);

      // Apply adaptive threshold for large corpora
      if (isLargeCorpus && result.similarity > 0) {
        // Boost similarity for large corpora
        const boostedSimilarity = Math.min(1, result.similarity * 1.2);
        return { similarity: boostedSimilarity };
      }

      return result;
    } catch (error) {
      console.error('Error computing similarity:', error);
      return { similarity: 0 };
    }
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
      return { similarity: 0 };
    }

    return {
      similarity: intersection.length / union.size
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

    for (const term of uniqueTerms) {
      const freq1 = freqMap1.get(term) || 0;
      const freq2 = freqMap2.get(term) || 0;

      dotProduct += freq1 * freq2;
      norm1 += freq1 * freq1;
      norm2 += freq2 * freq2;
    }

    if (norm1 === 0 || norm2 === 0) {
      return { similarity: 0 };
    }

    return {
      similarity: dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2))
    };
  }
}
