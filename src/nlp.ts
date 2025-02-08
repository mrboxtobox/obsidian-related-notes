import { Logger } from './logger';

export class WordTokenizer {
  tokenize(text: string): string[] {
    Logger.info('Starting tokenization of text:', { length: text.length });
    // Remove special characters and extra spaces, then split on whitespace
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(token => token.length > 0);

    Logger.info('Tokenization complete', {
      inputLength: text.length,
      tokenCount: tokens.length,
      sampleTokens: tokens.slice(0, 5)
    });

    return tokens;
  }
}

interface DocumentEntry {
  path: string;
  tokens: string[];
  mtime: number;
  length: number;  // Document length (token count)
}

export class BM25 {
  private documents: Map<string, DocumentEntry>;
  private documentCount: { [term: string]: number };
  private totalDocuments: number;
  private isDirty: boolean;
  private avgDocLength: number;

  // BM25 parameters
  private readonly k1 = 1.2;  // Term frequency saturation parameter
  private readonly b = 0.75;  // Length normalization parameter

  constructor() {
    Logger.info('Initializing BM25 processor');
    this.documents = new Map();
    this.documentCount = {};
    this.totalDocuments = 0;
    this.isDirty = false;
    this.avgDocLength = 0;
  }

  private updateAvgDocLength() {
    if (this.totalDocuments === 0) {
      this.avgDocLength = 0;
      return;
    }

    let totalLength = 0;
    this.documents.forEach(doc => {
      totalLength += doc.length;
    });
    this.avgDocLength = totalLength / this.totalDocuments;
  }

  addDocument(path: string, tokens: string[], mtime: number) {
    Logger.info('Adding/Updating document in BM25', {
      path,
      tokenCount: tokens.length,
      uniqueTokens: new Set(tokens).size
    });

    const existingDoc = this.documents.get(path);
    if (existingDoc) {
      // Remove old document's term frequencies
      const oldUniqueTerms = new Set(existingDoc.tokens);
      oldUniqueTerms.forEach(term => {
        this.documentCount[term]--;
        if (this.documentCount[term] === 0) {
          delete this.documentCount[term];
        }
      });
      this.totalDocuments--;
    }

    // Add new document
    this.documents.set(path, {
      path,
      tokens,
      mtime,
      length: tokens.length
    });
    this.totalDocuments++;

    // Update document frequency for each unique term
    const uniqueTerms = new Set(tokens);
    uniqueTerms.forEach(term => {
      this.documentCount[term] = (this.documentCount[term] || 0) + 1;
    });

    this.updateAvgDocLength();
    this.isDirty = true;
  }

  removeDocument(path: string) {
    Logger.info('Removing document from BM25', { path });
    const doc = this.documents.get(path);
    if (!doc) return;

    // Remove document's term frequencies
    const uniqueTerms = new Set(doc.tokens);
    uniqueTerms.forEach(term => {
      this.documentCount[term]--;
      if (this.documentCount[term] === 0) {
        delete this.documentCount[term];
      }
    });

    this.documents.delete(path);
    this.totalDocuments--;
    this.updateAvgDocLength();
    this.isDirty = true;
  }

  hasDocument(path: string): boolean {
    return this.documents.has(path);
  }

  getDocumentMtime(path: string): number | null {
    return this.documents.get(path)?.mtime ?? null;
  }

  clear() {
    this.documents.clear();
    this.documentCount = {};
    this.totalDocuments = 0;
    this.avgDocLength = 0;
    this.isDirty = true;
  }

  private termFrequency(term: string, doc: DocumentEntry): number {
    return doc.tokens.filter(t => t === term).length;
  }

  private idf(term: string): number {
    const docFreq = this.documentCount[term] || 0;
    if (docFreq === 0) return 0;
    // IDF formula: log(N-n+0.5/n+0.5), where N is total docs and n is docs containing term
    return Math.log(1 + (this.totalDocuments - docFreq + 0.5) / (docFreq + 0.5));
  }

  calculateVector(path: string): number[] | null {
    const doc = this.documents.get(path);
    if (!doc) {
      Logger.error(`No document found for path: ${path}`);
      return null;
    }

    Logger.info(`Calculating vector for ${path}`, {
      tokenCount: doc.tokens.length,
      uniqueTerms: new Set(doc.tokens).size
    });

    const terms = new Set(doc.tokens);
    const vector: number[] = [];

    terms.forEach(term => {
      const tf = this.termFrequency(term, doc);
      const idf = this.idf(term);

      // BM25 scoring formula
      const numerator = tf * (this.k1 + 1);
      const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength));
      const score = idf * (numerator / denominator);

      vector.push(score);
    });

    Logger.info(`Vector calculated for ${path}`, {
      vectorLength: vector.length,
      nonZeroElements: vector.filter(v => v !== 0).length
    });

    return vector;
  }

  get documentPaths(): string[] {
    return Array.from(this.documents.keys());
  }

  get isIndexDirty(): boolean {
    return this.isDirty;
  }

  markIndexClean() {
    this.isDirty = false;
  }
}
