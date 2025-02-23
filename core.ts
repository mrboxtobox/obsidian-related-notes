/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
*/


import { Vault, TFile } from 'obsidian';

'use strict';

const FREQUENCY_CAP = 10

export interface RelatedNote {
  file: TFile;
  similarity: number;
}

export interface SimilarityInfo {
  similarity: number;
}

export interface SimilarityProvider {
  initialize(): Promise<void>;
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
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

  function stem(word: string): string {
    if (word.length < 3) return word;

    word = word.toLowerCase();

    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('es')) return word.slice(0, -2);
    if (word.endsWith('s')) return word.slice(0, -1);
    if (word.endsWith('ed')) return word.slice(0, -2);
    if (word.endsWith('ing')) return word.slice(0, -3);

    return word;
  }

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
      .map(stem)
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
  private readonly nameToTFile = new Map<string, TFile>();

  constructor(
    private readonly vault: Vault,
    private readonly config = {
      numBands: 5,
      rowsPerBand: 5,
      shingleSize: 3,
      batchSize: 10,
      maxFiles: 100
    }
  ) {
    const signatureSize = config.numBands * config.rowsPerBand;
    if (signatureSize % config.numBands !== 0) {
      throw new Error('Signature size must be divisible by number of bands');
    }
  }

  getCandidateFiles(file: TFile): TFile[] {
    return this.relatedNotes.get(file.name) || [];
  }

  private shuffleArray(array: number[]): void {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async initialize(): Promise<void> {
    await this.buildVocabularyAndVectors();
    await this.generateHashFunctions();
    await this.createSignatures();
    await this.processCandidatePairs();
  }

  private async buildVocabularyAndVectors(): Promise<void> {
    for (const file of this.vault.getMarkdownFiles()) {
      this.nameToTFile.set(file.basename, file);
    }

    let processedCount = 0;
    for (const file of this.vault.getMarkdownFiles().slice(0, this.config.maxFiles)) {
      try {
        const content = await this.vault.cachedRead(file);
        const processed = tokenize(content);
        const shingles = this.buildShingles(processed);

        shingles.forEach(shingle => this.vocabulary.push(shingle));
        this.fileVectors.set(file.name, shingles);

        await this.yieldToMain(++processedCount, this.config.batchSize);
      } catch (error) {
        console.warn(`Error processing ${file.name}:`, error);
      }
    }
  }

  private async generateHashFunctions(): Promise<void> {
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

  private async createSignatures(): Promise<void> {
    let count = 0;
    for (const [fileName, shingles] of this.fileVectors) {
      const signature = await this.createSignature(shingles);
      this.signatures.set(fileName, signature);

      await this.yieldToMain(++count, this.config.batchSize);
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

  private async processCandidatePairs(): Promise<void> {
    const candidatePairs = this.findCandidatePairs();

    for (const [file1, file2] of candidatePairs) {
      const related1 = this.relatedNotes.get(file1) || [];
      const related2 = this.relatedNotes.get(file2) || [];

      related1.push(this.nameToTFile.get(file2)!);
      related2.push(this.nameToTFile.get(file1)!);

      this.relatedNotes.set(file1, related1);
      this.relatedNotes.set(file2, related2);
      console.log(this.relatedNotes)
    }
  }

  private findCandidatePairs(): [string, string][] {
    const candidatePairs = new Set<string>();
    const bandBuckets = new Map<string, string[]>();

    this.signatures.forEach((signature, fileName) => {
      const bands = this.splitSignature(signature);

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
    console.log("candidate pairs", candidatePairs)

    return Array.from(candidatePairs).map(pair => pair.split('||') as [string, string]);
  }

  private splitSignature(signature: number[]): number[][] {
    const bands: number[][] = [];
    for (let i = 0; i < signature.length; i += this.config.rowsPerBand) {
      bands.push(signature.slice(i, i + this.config.rowsPerBand));
    }
    return bands;
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
    try {
      const [content1, content2] = await Promise.all([
        this.vault.cachedRead(file1),
        this.vault.cachedRead(file2)
      ]);

      const tokens1 = tokenize(content1).split(' ');
      const tokens2 = tokenize(content2).split(' ');

      const freqMap1 = this.buildFrequencyMap(tokens1);
      const freqMap2 = this.buildFrequencyMap(tokens2);

      return this.calculateCosineSimilarity(freqMap1, freqMap2);
    } catch (error) {
      console.error('Error computing similarity:', error);
      return { similarity: 0 };
    }
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