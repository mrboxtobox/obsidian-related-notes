import { Logger } from '../logger';
import { EmbeddingProvider } from './types';
import { WordTokenizer, BM25 } from '../nlp';

export class BM25EmbeddingProvider implements EmbeddingProvider {
  name = 'BM25';
  description = 'Classic BM25 algorithm for document similarity';

  private bm25: BM25;
  private tokenizer: WordTokenizer;

  constructor() {
    this.bm25 = new BM25();
    this.tokenizer = new WordTokenizer();
  }

  async initialize(): Promise<void> {
    Logger.info('Initializing BM25 embedding provider');
  }

  async cleanup(): Promise<void> {
    Logger.info('Cleaning up BM25 embedding provider');
    this.bm25.clear();
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const tokens = this.tokenizer.tokenize(text);
    this.bm25.addDocument('temp', tokens, Date.now());
    const vector = this.bm25.calculateVector('temp') || [];
    this.bm25.removeDocument('temp');
    return vector;
  }

  calculateSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * (vec2[i] || 0);
      norm1 += vec1[i] * vec1[i];
      norm2 += (vec2[i] || 0) * (vec2[i] || 0);
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}
