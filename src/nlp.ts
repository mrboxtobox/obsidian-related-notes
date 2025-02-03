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

export class TfIdf {
  private documents: string[][];
  private documentCount: { [term: string]: number };
  private totalDocuments: number;

  constructor() {
    Logger.info('Initializing TF-IDF processor');
    this.documents = [];
    this.documentCount = {};
    this.totalDocuments = 0;
  }

  addDocument(tokens: string[]) {
    Logger.info('Adding document to TF-IDF', {
      tokenCount: tokens.length,
      uniqueTokens: new Set(tokens).size
    });
    // Add document to collection
    this.documents.push(tokens);
    this.totalDocuments++;

    // Update document frequency for each unique term
    const uniqueTerms = new Set(tokens);
    uniqueTerms.forEach(term => {
      this.documentCount[term] = (this.documentCount[term] || 0) + 1;
    });
  }

  tf(term: string, docTokens: string[]): number {
    const termCount = docTokens.filter(t => t === term).length;
    const tf = termCount / docTokens.length;
    Logger.info('Calculated term frequency', {
      term,
      count: termCount,
      docLength: docTokens.length,
      tf
    });
    return tf;
  }

  idf(term: string): number {
    const docFreq = this.documentCount[term] || 0;
    if (docFreq === 0) return 0;
    const idf = Math.log(this.totalDocuments / docFreq);
    Logger.info('Calculated inverse document frequency', {
      term,
      docFreq,
      totalDocs: this.totalDocuments,
      idf
    });
    return idf;
  }

  tfidf(term: string, docIndex: number): number {
    if (docIndex < 0 || docIndex >= this.documents.length) {
      Logger.warn('Invalid document index for TF-IDF calculation', { term, docIndex });
      return 0;
    }

    const doc = this.documents[docIndex];
    const tf = this.tf(term, doc);
    const idf = this.idf(term);
    const score = tf * idf;

    Logger.info('Calculated TF-IDF score', {
      term,
      docIndex,
      tf,
      idf,
      score
    });

    return score;
  }

  get documentsList(): string[][] {
    return this.documents;
  }
}
