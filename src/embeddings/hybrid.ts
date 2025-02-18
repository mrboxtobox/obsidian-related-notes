import { EmbeddingProvider } from './types';
import { Logger } from '../logger';

interface HybridSimilarityOptions {
  numHashes?: number;
  k1?: number;
  b?: number;
  numBands?: number;
  titleWeight?: number;
  fuzzyDistance?: number;
}

export class HybridEmbeddingProvider implements EmbeddingProvider {
  name = 'hybrid';
  description = 'Hybrid BM25 + MinHash LSH embeddings (Local)';
  private similarity: HybridSimilarityEngine;

  constructor() {
    this.similarity = new HybridSimilarityEngine({
      numHashes: 100,
      k1: 1.5,
      b: 0.75,
      numBands: 20,
      titleWeight: 2.0,
      fuzzyDistance: 1
    });
  }

  async initialize(): Promise<void> {
    // Nothing to initialize as HybridSimilarityEngine handles its own initialization
    Logger.debug('HybridEmbeddingProvider initialized');
  }

  async cleanup(): Promise<void> {
    // Clear all internal maps
    this.similarity = new HybridSimilarityEngine();
    Logger.debug('HybridEmbeddingProvider cleaned up');
  }

  async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Use a temporary ID for the document
      const tempId = 'temp_' + Date.now();
      this.similarity.addDocument(tempId, text);

      // Get the MinHash signature for this document
      const signature = this.similarity.signatures.get(tempId);
      if (!signature) {
        throw new Error('Failed to generate MinHash signature');
      }

      // Get BM25 scores for terms in this document
      const { title, content } = this.similarity.preprocess(text);
      const bm25Scores = this.calculateBM25Scores(title, content, tempId);

      // Combine MinHash signature with BM25 scores
      const combinedVector = [...signature, ...bm25Scores];

      // Cleanup temporary document
      this.cleanup();

      return combinedVector;
    } catch (error) {
      Logger.error('Error generating hybrid embedding:', error);
      throw error;
    }
  }

  calculateSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same length');
    }

    // Split vectors into MinHash and BM25 parts
    const hashLength = this.similarity.numHashes;
    const minhash1 = vec1.slice(0, hashLength);
    const minhash2 = vec2.slice(0, hashLength);
    const bm251 = vec1.slice(hashLength);
    const bm252 = vec2.slice(hashLength);

    // Calculate Jaccard similarity from MinHash
    const jaccardSim = this.calculateJaccardSimilarity(minhash1, minhash2);

    // Calculate cosine similarity for BM25 scores
    const bm25Sim = this.calculateCosineSimilarity(bm251, bm252);

    // Combine similarities with equal weights
    return (jaccardSim + bm25Sim) / 2;
  }

  private calculateJaccardSimilarity(sig1: number[], sig2: number[]): number {
    let matches = 0;
    for (let i = 0; i < sig1.length; i++) {
      if (sig1[i] === sig2[i]) matches++;
    }
    return matches / sig1.length;
  }

  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * vec2[i];
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];
    }

    norm1 = Math.sqrt(norm1);
    norm2 = Math.sqrt(norm2);

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (norm1 * norm2);
  }

  private calculateBM25Scores(titleTokens: string[], contentTokens: string[], docId: string): number[] {
    // Get unique terms from both title and content
    const uniqueTerms = Array.from(new Set([...titleTokens, ...contentTokens]));

    // Calculate BM25 score for each term
    return uniqueTerms.map(term => {
      // Calculate term frequencies in title and content
      const titleTf = titleTokens.filter(t => this.isFuzzyMatch(t, term)).length;
      const contentTf = contentTokens.filter(t => this.isFuzzyMatch(t, term)).length;

      // Weight title matches more heavily
      const weightedTf = (titleTf * this.similarity.titleWeight) + contentTf;

      const df = this.similarity.documentFrequencies.get(term) || 0;
      const docLength = titleTokens.length + contentTokens.length;

      // Enhanced BM25 calculation with better length normalization
      const idf = Math.log(
        (this.similarity.documents.size - df + 0.5) / (df + 0.5) + 1
      );

      // Non-linear term frequency scoring
      const numerator = weightedTf * (this.similarity.k1 + 1);
      const denominator = weightedTf + this.similarity.k1 * (
        1 - this.similarity.b + this.similarity.b *
        (docLength / this.similarity.averageDocLength)
      );

      return idf * (numerator / denominator);
    });
  }

  private isFuzzyMatch(str1: string, str2: string): boolean {
    if (str1 === str2) return true;
    if (Math.abs(str1.length - str2.length) > this.similarity.fuzzyDistance) return false;

    let differences = 0;
    const maxDiff = this.similarity.fuzzyDistance;

    // Simple Levenshtein distance calculation
    const matrix: number[][] = [];
    for (let i = 0; i <= str1.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str2.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str1.length; i++) {
      for (let j = 1; j <= str2.length; j++) {
        if (str1[i - 1] === str2[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1, // substitution
            Math.min(
              matrix[i - 1][j] + 1, // deletion
              matrix[i][j - 1] + 1  // insertion
            )
          );
        }
      }
    }

    return matrix[str1.length][str2.length] <= maxDiff;
  }
}

class HybridSimilarityEngine {
  numHashes: number;
  k1: number;
  b: number;
  titleWeight: number;
  fuzzyDistance: number;
  documents: Map<string, { title: string[]; content: string[] }>;
  documentLengths: Map<string, number>;
  averageDocLength: number;
  termFrequencies: Map<string, Map<string, number>>;
  documentFrequencies: Map<string, number>;
  signatures: Map<string, number[]>;
  private hashFunctions: { a: number; b: number; }[];
  private lshIndex: Map<number, Set<string>>;
  private numBands: number;
  private bandSize: number;

  constructor(options: HybridSimilarityOptions = {}) {
    this.numHashes = options.numHashes || 100;
    this.k1 = options.k1 || 1.5;
    this.b = options.b || 0.75;
    this.titleWeight = options.titleWeight || 2.0;
    this.fuzzyDistance = options.fuzzyDistance || 1;

    // Initialize storage
    this.documents = new Map();
    this.documentLengths = new Map();
    this.averageDocLength = 0;
    this.termFrequencies = new Map();
    this.documentFrequencies = new Map();
    this.signatures = new Map();

    // Initialize LSH
    this.numBands = options.numBands || 20;
    this.bandSize = Math.floor(this.numHashes / this.numBands);
    this.hashFunctions = this.generateHashFunctions();
    this.lshIndex = new Map();
  }

  preprocess(text: string): { title: string[]; content: string[] } {
    // Extract title (first heading) and content
    const lines = text.split('\n');
    let title: string[] = [];
    let content: string[] = [];

    // Find first heading
    const titleMatch = lines.find(line => line.startsWith('# '));
    if (titleMatch) {
      title = this.tokenize(titleMatch.replace(/^#\s+/, ''));
    }

    // Process content
    content = this.tokenize(text);

    return { title, content };
  }

  private tokenize(text: string): string[] {
    return text
      .replace(/\[\[([^\]]+)\]\]/g, '$1') // Convert wiki links
      .replace(/\!?\[[^\]]*\]\([^\)]+\)/g, '') // Remove markdown links
      .replace(/^---[\s\S]*?---/m, '') // Remove frontmatter
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  addDocument(docId: string, text: string): void {
    const { title, content } = this.preprocess(text);

    // BM25 indexing
    this.indexBM25(docId, title, content);

    // MinHash signature
    const signature = this.calculateMinHash(new Set([...title, ...content]));
    this.signatures.set(docId, signature);

    // LSH indexing
    this.indexLSH(docId, signature);
  }

  private indexBM25(docId: string, titleTokens: string[], contentTokens: string[]): void {
    this.documents.set(docId, { title: titleTokens, content: contentTokens });
    const docLength = titleTokens.length + contentTokens.length;
    this.documentLengths.set(docId, docLength);

    let totalLength = 0;
    this.documentLengths.forEach(length => totalLength += length);
    this.averageDocLength = totalLength / this.documents.size;

    // Index both title and content terms
    [...titleTokens, ...contentTokens].forEach(term => {
      if (!this.termFrequencies.has(term)) {
        this.termFrequencies.set(term, new Map());
      }
      const docFreqs = this.termFrequencies.get(term)!;
      docFreqs.set(docId, (docFreqs.get(docId) || 0) + 1);

      this.documentFrequencies.set(
        term,
        (this.documentFrequencies.get(term) || 0) + 1
      );
    });
  }

  private generateHashFunctions(): { a: number; b: number; }[] {
    return Array.from({ length: this.numHashes }, () => ({
      a: Math.floor(Math.random() * 2147483647),
      b: Math.floor(Math.random() * 2147483647)
    }));
  }

  private calculateMinHash(tokenSet: Set<string>): number[] {
    const signature = new Array(this.numHashes).fill(Infinity);

    tokenSet.forEach(token => {
      const hash = this.hashString(token);

      this.hashFunctions.forEach((func, i) => {
        const value = (func.a * hash + func.b) % 2147483647;
        signature[i] = Math.min(signature[i], value);
      });
    });

    return signature;
  }

  private indexLSH(docId: string, signature: number[]): void {
    for (let band = 0; band < this.numBands; band++) {
      const bandSignature = signature.slice(
        band * this.bandSize,
        (band + 1) * this.bandSize
      );
      const bandHash = this.hashBand(bandSignature);

      if (!this.lshIndex.has(bandHash)) {
        this.lshIndex.set(bandHash, new Set());
      }
      this.lshIndex.get(bandHash)!.add(docId);
    }
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash);
  }

  private hashBand(band: number[]): number {
    return band.reduce((hash, value) => {
      hash = ((hash << 5) - hash) + value;
      return hash & hash;
    }, 0);
  }
}
