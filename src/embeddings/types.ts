import { TFile } from 'obsidian';

export interface EmbeddingVector {
  vector: number[];
  mtime: number;
}

export interface EmbeddingProvider {
  name: string;
  description: string;

  /**
   * Generate an embedding vector for the given text
   */
  generateEmbedding(text: string): Promise<number[]>;

  /**
   * Calculate similarity between two vectors
   */
  calculateSimilarity(vec1: number[], vec2: number[]): number;

  /**
   * Initialize the provider with any necessary setup
   */
  initialize(): Promise<void>;

  /**
   * Clean up any resources when the provider is no longer needed
   */
  cleanup(): Promise<void>;
}

export interface EmbeddingCache {
  get(file: TFile): EmbeddingVector | undefined;
  set(file: TFile, vector: EmbeddingVector): void;
  delete(file: TFile): void;
  clear(): void;
}

export class MemoryEmbeddingCache implements EmbeddingCache {
  private cache = new Map<string, EmbeddingVector>();

  get(file: TFile): EmbeddingVector | undefined {
    return this.cache.get(file.path);
  }

  set(file: TFile, vector: EmbeddingVector): void {
    this.cache.set(file.path, vector);
  }

  delete(file: TFile): void {
    this.cache.delete(file.path);
  }

  clear(): void {
    this.cache.clear();
  }
}
