import { Logger } from '../logger';
import { EmbeddingProvider, EmbeddingCache, MemoryEmbeddingCache } from './types';
import { BM25EmbeddingProvider } from './bm25';
import { HybridEmbeddingProvider } from './hybrid';
import { TFile } from 'obsidian';

export class EmbeddingManager {
  private provider: EmbeddingProvider;
  private cache: EmbeddingCache;

  constructor(providerType: 'bm25' | 'hybrid') {
    this.cache = new MemoryEmbeddingCache();
    this.provider = this.createProvider(providerType);
  }

  private createProvider(type: 'bm25' | 'hybrid'): EmbeddingProvider {
    switch (type) {
      case 'bm25':
        return new BM25EmbeddingProvider();
      case 'hybrid':
        return new HybridEmbeddingProvider();
      default:
        Logger.error(`Unknown embedding provider type: ${type}`);
        throw new Error(`Unknown embedding provider type: ${type}`);
    }
  }

  async initialize(): Promise<void> {
    await this.provider.initialize();
  }

  async cleanup(): Promise<void> {
    await this.provider.cleanup();
    this.cache.clear();
  }

  async switchProvider(type: 'bm25' | 'hybrid'): Promise<void> {
    await this.cleanup();
    this.provider = this.createProvider(type);
    await this.initialize();
  }

  async generateEmbedding(file: TFile, content: string): Promise<number[]> {
    try {
      const vector = await this.provider.generateEmbedding(content);
      this.cache.set(file, {
        vector,
        mtime: file.stat.mtime
      });
      return vector;
    } catch (error) {
      Logger.error(`Error generating embedding for ${file.path}:`, error);
      throw error;
    }
  }

  getCachedEmbedding(file: TFile): number[] | undefined {
    const cached = this.cache.get(file);
    if (cached && cached.mtime === file.stat.mtime) {
      return cached.vector;
    }
    return undefined;
  }

  calculateSimilarity(vec1: number[], vec2: number[]): number {
    return this.provider.calculateSimilarity(vec1, vec2);
  }

  clearCache(): void {
    this.cache.clear();
  }

  removeFromCache(file: TFile): void {
    this.cache.delete(file);
  }
}
