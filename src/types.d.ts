declare module 'natural' {
  export class TfIdf {
    constructor();
    addDocument(document: string | string[], key?: string): void;
    tfidfs(searchTerm: string | string[], callback?: (i: number, measure: number) => void): number[];
    tfidf(term: string, docIndex: number): number;
    listTerms(d: number): { term: string; tfidf: number }[];
    documents: any[];
  }

  export class WordTokenizer {
    tokenize(text: string): string[];
  }

  export class PorterStemmer {
    static stem(word: string): string;
    static tokenizeAndStem(text: string): string[];
  }

  export class Metaphone {
    static process(word: string, maxLength?: number): string;
  }

  export class SoundEx {
    static process(word: string, maxLength?: number): string;
  }

  export class JaroWinklerDistance {
    static compare(s1: string, s2: string): number;
  }

  export class LevenshteinDistance {
    static compute(s1: string, s2: string): number;
  }
}
