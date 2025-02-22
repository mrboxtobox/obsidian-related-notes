/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
*/

import { Logger, simpleStem } from './utils';
import { AlgorithmConfig, DEFAULT_CONFIG } from './settings';
import { TFile, Vault } from 'obsidian';

// NLP Components
/**
 * Interface for similarity providers that calculate similarity between notes
 * using different algorithms and optimization techniques.
 */
export interface SimilarityProvider {
  name: string;
  description: string;
  initialize(): Promise<void>;
  cleanup(path?: string): Promise<void>;
  generateVector(text: string): Promise<number[] | Map<number, number>>;
  calculateSimilarity(f1: string, f2: string): Promise<{ similarity: number; topWords: string[] }> | { similarity: number; topWords: string[] };
}

interface TokenizeOptions {
  minLength?: number;
  removeStopWords?: boolean;
  handleContractions?: boolean;
}

/**
 * Utility class for tokenizing text into words.
 * Handles advanced text preprocessing including contraction handling,
 * stop word removal, and configurable options.
 */
class Preprocessor {
  private readonly stopWords = new Set([
    // Articles
    'a', 'an', 'the',

    // Pronouns
    'i', 'me', 'my', 'myself',
    'you', 'your', 'yours', 'yourself', 'yourselves',
    'he', 'him', 'his', 'himself',
    'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself',
    'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'this', 'that', 'these', 'those',
    'who', 'whom', 'whose', 'which', 'what',

    // Prepositions
    'about', 'above', 'across', 'after', 'against', 'along', 'among', 'around',
    'at', 'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
    'beyond', 'by', 'despite', 'down', 'during', 'except', 'for', 'from',
    'in', 'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto',
    'out', 'outside', 'over', 'past', 'since', 'through', 'throughout',
    'to', 'toward', 'towards', 'under', 'underneath', 'until', 'up', 'upon',
    'with', 'within', 'without',

    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet',
    'because', 'although', 'unless', 'whereas', 'while',

    // Auxiliary verbs
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'having',
    'do', 'does', 'did', 'doing',
    'would', 'should', 'could', 'might', 'must', 'shall', 'will', 'can',

    // Common contractions
    'im', 'ive', 'id', 'ill',
    'youre', 'youve', 'youd', 'youll',
    'hes', 'hed', 'hell',
    'shes', 'shed', 'shell',
    'were', 'weve', 'wed', 'well',
    'theyre', 'theyve', 'theyd', 'theyll',
    'its', 'itll',
    'dont', 'cant', 'wont', 'shouldnt', 'couldnt', 'wouldnt',
    'isnt', 'arent', 'wasnt', 'werent',
    'hasnt', 'havent', 'hadnt',
    'doesnt', 'dont', 'didnt',

    // Common adverbs
    'very', 'really', 'quite', 'rather', 'somewhat', 'too',
    'much', 'many', 'more', 'most', 'some', 'any',
    'here', 'there', 'where', 'when', 'why', 'how',
    'again', 'once', 'twice', 'always', 'never', 'sometimes',
    'often', 'seldom', 'usually', 'normally',

    // Other common words
    'yes', 'no', 'not', 'now', 'then', 'just', 'only',
    'also', 'still', 'else', 'back', 'well', 'even', 'either',
    'neither', 'both', 'each', 'every', 'all', 'none', 'such',
    'same', 'different', 'other', 'another', 'few', 'several', 'many',
    'much', 'own', 'may', 'let'
  ]);

  private readonly contractionMap: { [key: string]: string } = {
    "won't": "will not",
    "can't": "cannot",
    "n't": " not",
    "'re": " are",
    "'s": " is",
    "'d": " would",
    "'ll": " will",
    "'ve": " have",
    "'m": " am"
  };

  tokenize(text: string, options: TokenizeOptions = {}): string[] {
    if (!text || typeof text !== 'string') {
      return []
    }

    const {
      minLength = 2,
      removeStopWords = true,
      handleContractions = true
    } = options;

    try {
      let processedText = text
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/\!?\[[^\]]*\]\([^\)]+\)/g, '')
        .replace(/^---[\s\S]*?---/m, '');

      if (handleContractions) {
        processedText = processedText.replace(
          new RegExp(Object.keys(this.contractionMap).join('|'), 'g'),
          matched => this.contractionMap[matched]
        );
      }

      return processedText
        .toLowerCase()
        // First handle numbers with units or special formatting
        .replace(/\d+(?:\.\d+)?(?:px|em|rem|%|\$)?\s*(?:x\s*\d+)?/g, 'NUMBER')
        // Then replace remaining non-letter characters
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(word =>
          word.length > minLength &&
          (!removeStopWords || !this.stopWords.has(word))
        )
        .map(word => simpleStem(word));
    } catch (error) {
      Logger.error('Error during tokenization:', error);
      return [];
    }
  }

  tokenizeV2(text: string, options: TokenizeOptions = {}): string {
    if (!text || typeof text !== 'string') {
      return ''
    }

    const {
      minLength = 2,
      removeStopWords = true,
      handleContractions = true
    } = options;

    try {
      let processedText = text
        .replace(/\[\[([^\]]+)\]\]/g, '$1')
        .replace(/\!?\[[^\]]*\]\([^\)]+\)/g, '')
        .replace(/^---[\s\S]*?---/m, '');

      if (handleContractions) {
        processedText = processedText.replace(
          new RegExp(Object.keys(this.contractionMap).join('|'), 'g'),
          matched => this.contractionMap[matched]
        );
      }

      return processedText
        .toLowerCase()
        // First handle numbers with units or special formatting
        .replace(/\d+(?:\.\d+)?(?:px|em|rem|%|\$)?\s*(?:x\s*\d+)?/g, 'NUMBER')
        // Then replace remaining non-letter characters
        .replace(/[^a-z\s]/g, ' ')
        .split(/\s+/)
        .filter(word =>
          word.length > minLength &&
          (!removeStopWords || !this.stopWords.has(word))
        )
        .map(word => simpleStem(word))
        .join(' ');
    } catch (error) {
      Logger.error('Error during tokenization:', error);
      return '';
    }
  }
}

interface DocumentEntry {
  path: string;
  tokens: string[];
  mtime: number;
  length: number;
}

// According to Claude, Trigrams seem to work well for shingles.
const SHINGLE_SIZE = 3;
// const SIGNATURE_SIZE = 10;
// const NUM_BANDS = 5; // Number of subvectors

// const SIGNATURE_SIZE = 100; // Larger signatures improve accuracy
// TODO: Fix
// const NUM_BANDS = Math.ceil(Math.sqrt(300)); // N = number of documents
// const ROWS_PER_BAND = Math.ceil(SIGNATURE_SIZE / NUM_BANDS);

export class SimilarityProviderV2 implements SimilarityProvider {
  name: string;
  description: string;

  // TODO(olu): We will need to incrementally update this index as files change
  // during a session.
  // TODO(olu): Occasionally rebuild the index to avoid drift.
  // Fixed ordering.
  private vocabulary: string[];
  // Map from filename to corresponding one-hot vector as set.
  private fileVectors: Map<string, Set<string>>;
  private signatures: Map<string, number[]>;
  private vault: Vault;
  private preprocessor: Preprocessor;
  // List of permutations
  private minhashFunctions: number[][];
  private numBands: number;
  private bandSize: number;
  private candidatePairs: [string, string][]
  private signatureSize: number;
  private relatedNotes: Map<string, Set<string>>;


  constructor(vault: Vault) {
    this.vocabulary = [];
    this.fileVectors = new Map();
    this.vault = vault;
    this.preprocessor = new Preprocessor();
    this.minhashFunctions = [];
    const params = this.calculateLSHParams(vault.getMarkdownFiles().length)
    this.signatures = new Map()
    this.numBands = params.numBands;
    this.bandSize = params.rowsPerBand;
    this.signatureSize = params.signatureSize;
    this.relatedNotes = new Map();

    if (params.signatureSize % this.numBands !== 0) {
      throw new Error('Signature size must be divisible by number of bands');
    }
  }

  calculateLSHParams(numDocs: number) {
    const signatureSize = Math.min(200, Math.max(100, Math.ceil(numDocs * 0.02)));
    const numBands = Math.ceil(Math.sqrt(numDocs));
    const rowsPerBand = Math.ceil(signatureSize / numBands);
    const adjustedSignatureSize = numBands * rowsPerBand;

    return {
      signatureSize: adjustedSignatureSize,
      numBands,
      rowsPerBand,
      shingleSize: 3
    };
  }

  // Fisher–Yates (aka Knuth).
  private shuffleArray(array: number[]) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  async initialize(): Promise<void> {
    // Initialize the dictionary with the shingles.

    for (const file of this.vault.getMarkdownFiles()) {
      try {
        const fileContent = await this.vault.cachedRead(file);
        const processed = this.preprocessor.tokenizeV2(fileContent)

        const shingles = this.buildShingles(processed, SHINGLE_SIZE);
        shingles.forEach(shingle => this.vocabulary.push(shingle));
        this.fileVectors.set(file.name, shingles);
      } catch (error) {
        Logger.warn(`Error processing ${file.name}:`, error);
      }
    }

    for (let i = 0; i < this.signatureSize; i++) {
      const hashFunc = Array.from({ length: this.vocabulary.length }, (_, i) => i + 1);
      this.shuffleArray(hashFunc);
      this.minhashFunctions.push(hashFunc);
    }

    // Second pass: create signatures
    this.fileVectors.forEach((shingles, fileName) => {
      this.signatures.set(fileName, this.createSignature(shingles));
    });

    // Banding
    this.candidatePairs = this.findCandidatePairs(this.signatures);
    Logger.error("Candidate Pairs: ")
    Logger.error(`Candidates count: ${this.candidatePairs.length}`)
    for (let pair of this.candidatePairs) {
      // Logger.error(`${pair}`)
      const exist0 = this.relatedNotes.get(pair[0]) || new Set();
      exist0.add(pair[1])
      const exist1 = this.relatedNotes.get(pair[1]) || new Set();
      exist1.add(pair[0])
      this.relatedNotes.set(pair[0], exist0);
      this.relatedNotes.set(pair[1], exist1);
    }
  }

  private createSignature(shingles: Set<string>): number[] {
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

  private splitSignature(signature: number[]): number[][] {
    const bands: number[][] = [];
    for (let i = 0; i < signature.length; i += this.bandSize) {
      bands.push(signature.slice(i, i + this.bandSize));
    }
    return bands;
  }

  private hashBand(band: number[]): string {
    return band.join(',');
  }

  findCandidatePairs(signatures: Map<string, number[]>): [string, string][] {
    const candidatePairs = new Set<string>();
    const bandBuckets = new Map<string, string[]>();

    // Process each signature into bands and hash
    signatures.forEach((signature, fileName) => {
      const bands = this.splitSignature(signature);

      bands.forEach((band, bandIdx) => {
        const hashValue = this.hashBand(band);
        const bucketKey = `${bandIdx}-${hashValue}`;

        if (!bandBuckets.has(bucketKey)) {
          bandBuckets.set(bucketKey, []);
        }
        bandBuckets.get(bucketKey)!.push(fileName);
      });
    });

    // Find candidates from bucket collisions
    bandBuckets.forEach((fileNames) => {
      if (fileNames.length > 1) {
        for (let i = 0; i < fileNames.length; i++) {
          for (let j = i + 1; j < fileNames.length; j++) {
            const pair = [fileNames[i], fileNames[j]].sort();
            candidatePairs.add(pair.join('||'));
          }
        }
      }
    });

    return Array.from(candidatePairs).map(pair => pair.split('||') as [string, string]);
  }


  async cleanup(path?: string): Promise<void> {
    Logger.debug("Cleanup");
  }

  async generateVector(text: string): Promise<number[] | Map<number, number>> {
    Logger.debug("Cleanup");
    return [];
  }

  calculateSimilarity(f1: string, f2: string): Promise<{ similarity: number; topWords: string[]; }> | { similarity: number; topWords: string[]; } {
    Logger.error(f1)
    Logger.error(f2)
    if (this.relatedNotes.get(f1)?.has(f2) || this.relatedNotes.get(f2)?.has(f1)) {
      return {
        similarity: 1,
        topWords: ["a"]
      };
    }
    return {
      similarity: 0.5,
      topWords: ["a"]
    };
  }

  clear() {
  }


  /**
   * See https://www.pinecone.io/learn/series/faiss/locality-sensitive-hashing/.
   */
  private buildShingles(text: string, k: number): Set<string> {
    const shingles = new Set<string>();
    for (let i = 0; i <= text.length - k; i++) {
      const shingle = text.slice(i, i + k);
      shingles.add(shingle);
    }
    return shingles;
  }

  private minhash() {

  }
}
