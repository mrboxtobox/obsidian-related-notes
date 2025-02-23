/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
*/

import { Vault, TFile } from 'obsidian';


// According to Claude, Trigrams seem to work well for shingles.
const FREQUENCY_CAP = 10

/**
 * Interface for similarity providers that calculate similarity between notes
 * using different algorithms and optimization techniques.
 */
export interface RelatedNote {
  file: TFile;
  similarity: number;
}

export interface SimilarityInfo {
  similarity: number;
}

export interface SimilarityProvider {
  initialize(): Promise<void>;
  cleanup(path?: string): Promise<void>;
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
}

/**
 * Utility class for tokenizing text into words.
 * Handles advanced text preprocessing including contraction handling,
 * stop word removal, and configurable options.
 */
export function tokenize(text: string): string {
  if (!text) return '';

  const stopWords = new Set([
    'a', 'an', 'the', 'i', 'me', 'my', 'myself', 'you', 'your', 'yours',
    'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
    'hers', 'herself', 'it', 'its', 'itself', 'we', 'us', 'our', 'ours',
    'ourselves', 'they', 'them', 'their', 'theirs', 'themselves', 'this',
    'that', 'these', 'those', 'who', 'whom', 'whose', 'which', 'what', 'about',
    'above', 'across', 'after', 'against', 'along', 'among', 'around', 'at',
    'before', 'behind', 'below', 'beneath', 'beside', 'besides', 'between',
    'beyond', 'by', 'despite', 'down', 'during', 'except', 'for', 'from', 'in',
    'inside', 'into', 'like', 'near', 'of', 'off', 'on', 'onto', 'out',
    'outside', 'over', 'past', 'since', 'through', 'throughout', 'to', 'toward',
    'towards', 'under', 'underneath', 'until', 'up', 'upon', 'with', 'within',
    'without', 'and', 'but', 'or', 'nor', 'so', 'yet', 'because', 'although',
    'unless', 'whereas', 'while', 'am', 'is', 'are', 'was', 'were', 'be',
    'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did',
    'doing', 'would', 'should', 'could', 'might', 'must', 'shall', 'will',
    'can', 'im', 'ive', 'id', 'ill', 'youre', 'youve', 'youd', 'youll', 'hes',
    'hed', 'hell', 'shes', 'shed', 'shell', 'were', 'weve', 'wed', 'well',
    'theyre', 'theyve', 'theyd', 'theyll', 'its', 'itll', 'dont', 'cant',
    'wont', 'shouldnt', 'couldnt', 'wouldnt', 'isnt', 'arent', 'wasnt',
    'werent', 'hasnt', 'havent', 'hadnt', 'doesnt', 'dont', 'didnt', 'very',
    'really', 'quite', 'rather', 'somewhat', 'too', 'much', 'many', 'more',
    'most', 'some', 'any', 'here', 'there', 'where', 'when', 'why', 'how',
    'again', 'once', 'twice', 'always', 'never', 'sometimes', 'often', 'seldom',
    'usually', 'normally', 'yes', 'no', 'not', 'now', 'then', 'just', 'only',
    'also', 'still', 'else', 'back', 'well', 'even', 'either', 'neither',
    'both', 'each', 'every', 'all', 'none', 'such', 'same', 'different',
    'other', 'another', 'few', 'several', 'much', 'own', 'may', 'let'
  ]);

  const contractions: { [key: string]: string } = {
    "won't": "will not", "can't": "cannot", "n't": " not",
    "'re": " are", "'s": " is", "'d": " would",
    "'ll": " will", "'ve": " have", "'m": " am"
  };

  // Helper function for stemming
  function stem(word: string): string {
    if (word.length < 3) return word;

    word = word.toLowerCase().replace(/['']s?$/g, '');

    const isVowel = (c: string) => /[aeiou]/i.test(c);
    const syllables = word.split('').reduce((count, char, i, arr) =>
      count + (isVowel(char) && !isVowel(arr[i - 1] || '') ? 1 : 0), 0);

    if (/([bcdfghjklmnpqrstvwxz])\1$/.test(word)) {
      word = word.slice(0, -1);
    }

    const specials: { [key: string]: string } = {
      'having': 'have', 'being': 'be', 'going': 'go', 'doing': 'do',
      'saying': 'say', 'lives': 'life', 'wives': 'wife', 'leaves': 'leaf',
      'tries': 'try', 'taxes': 'tax', 'uses': 'use', 'becomes': 'become',
      'makes': 'make', 'taking': 'take', 'looking': 'look', 'coming': 'come',
      'dying': 'die', 'lying': 'lie', 'tying': 'tie'
    };
    if (specials[word]) return specials[word];

    const rules = [
      { s: 'ization', r: 'ize' },
      { s: 'fulness', r: 'ful' }, { s: 'ousness', r: 'ous' },
      { s: 'iveness', r: 'ive' }, { s: 'ality', r: 'al' },
      { s: 'ously', r: 'ous' }, { s: 'ently', r: 'ent' },
      { s: 'ably', r: 'able' },
      { s: 'ing', r: '', c: (w: string) => w.length > 4 && syllables > 1 },
      { s: 'ying', r: 'y' },
      { s: 'ed', r: '', c: (w: string) => w.length > 3 && /[bcdfghjklmnpqrstvwxz]ed$/.test(w) },
      { s: 'ies', r: 'y' }, { s: 'ied', r: 'y' },
      { s: 'ement', r: '' }, { s: 'ments', r: '' }, { s: 'ness', r: '' },
      { s: 'ational', r: 'ate' }, { s: 'tional', r: 'tion' },
      { s: 'enci', r: 'ence' }, { s: 'anci', r: 'ance' },
      { s: 'izer', r: 'ize' }, { s: 'ator', r: 'ate' },
      { s: 'able', r: '' }, { s: 'ible', r: '' },
      { s: 'tion', r: 't' }, { s: 'sion', r: 's' },
      { s: 'ful', r: '' }, { s: 'ant', r: '' }, { s: 'ent', r: '' },
      { s: 'ism', r: '' }, { s: 'ist', r: '' }, { s: 'ity', r: '' },
      { s: 'ive', r: '' }, { s: 'ize', r: '' }, { s: 'ous', r: '' },
      { s: 's', r: '', c: (w: string) => w.length > 3 && !/[aeiou]s$/.test(w) && !/ss$/.test(w) }
    ];

    for (const { s: suffix, r: replacement, c: condition } of rules) {
      if (word.endsWith(suffix)) {
        const stem = word.slice(0, -suffix.length) + replacement;
        if (!condition || condition(stem)) {
          if (stem.length > 1 && /([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) {
            return stem.slice(0, -1);
          }
          return stem;
        }
      }
    }

    if (/[bcdfghjklmnpqrstvwxz]y$/.test(word)) {
      return word.slice(0, -1) + 'i';
    }

    return word;
  }

  try {
    let processedText = text
      .replace(/\[\[([^\]]+)\]\]/g, '$1')
      .replace(/\!?\[[^\]]*\]\([^\)]+\)/g, '')
      .replace(/^---[\s\S]*?---/m, '');

    processedText = processedText.replace(
      new RegExp(Object.keys(contractions).join('|'), 'g'),
      matched => contractions[matched]
    );

    return processedText
      // Preserve hyphenated terms
      .replace(/(\w)-(\w)/g, '$1_$2')
      // Replace URLs and email addresses with tokens
      .replace(/\b[\w\-]+(\.[\w\-]+)+\b/g, 'URL')
      .replace(/[\w\-\.]+@[\w\-\.]+/g, 'EMAIL')
      // Handle numbers with units
      .replace(/\d+(?:\.\d+)?(?:px|em|rem|%|\$|k|m|b|gb|mb|kb)/gi, 'MEASUREMENT')
      // Clean special characters while preserving word boundaries
      .replace(/[^\w\s_-]/g, ' ')
      // Restore hyphens
      .replace(/_/g, '-')
      .toLowerCase()
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .map(word => stem(word))
      .join(' ');
  } catch (error) {
    console.error('Error during tokenization:', error);
    return '';
  }
}

export class SimilarityProviderV2 implements SimilarityProvider {
  // TODO(olu): We will need to incrementally update this index as files change
  // during a session.
  // TODO(olu): Occasionally rebuild the index to avoid drift.
  // Fixed ordering.
  private vocabulary: string[];
  // Map from filename to corresponding one-hot vector as set.
  private fileVectors: Map<string, Set<string>>;
  private signatures: Map<string, number[]>;
  private vault: Vault;
  // List of permutations
  private minhashFunctions: number[][];
  private numBands: number;
  private bandSize: number;
  private candidatePairs: [string, string][]
  private signatureSize: number;
  private relatedNotes: Map<string, TFile[]>;
  private nameToTFile: Map<string, TFile>;
  private shingleSize: number;

  constructor(vault: Vault) {
    this.vocabulary = [];
    this.fileVectors = new Map();
    this.vault = vault;
    this.minhashFunctions = [];
    const params = this.calculateLSHParams(vault.getMarkdownFiles().length)
    this.signatures = new Map()
    this.numBands = params.numBands;
    this.bandSize = params.rowsPerBand;
    this.signatureSize = params.signatureSize;
    this.shingleSize = params.shingleSize;
    this.relatedNotes = new Map();
    this.nameToTFile = new Map();

    if (params.signatureSize % this.numBands !== 0) {
      throw new Error('Signature size must be divisible by number of bands');
    }
  }

  getCandidateFiles(file: TFile): TFile[] {
    return this.relatedNotes.get(file.name) || [];
  }

  calculateLSHParams(numDocs: number) {
    const signatureSize = 100; //Math.min(200, Math.max(20, Math.ceil(numDocs * 0.02)));
    const numBands = 100; // Math.ceil(Math.sqrt(numDocs));
    const rowsPerBand = 2; // Math.ceil(signatureSize / numBands);
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
    let processedCount = 0;

    for (const file of this.vault.getMarkdownFiles().splice(1, 20)) {
      try {
        this.nameToTFile.set(file.basename, file);
        const fileContent = await this.vault.cachedRead(file);
        const processed = tokenize(fileContent)

        const shingles = this.buildShingles(processed, this.shingleSize);
        shingles.forEach(shingle => this.vocabulary.push(shingle));
        this.fileVectors.set(file.name, shingles);
        // Yield every 10 files
        if (++processedCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 0));
          console.log("yielding initialize");
        }
      } catch (error) {
        console.warn(`Error processing ${file.name}:`, error);
      }
    }

    // Build the hash functions.
    for (let i = 0; i < this.signatureSize; i++) {
      const hashFunc = Array.from({ length: this.vocabulary.length }, (_, i) => i + 1);
      this.shuffleArray(hashFunc);
      this.minhashFunctions.push(hashFunc);
    }

    // Second pass: create signatures
    let signatureCount = 0;
    for (const [fileName, shingles] of this.fileVectors) {
      const signature = await this.createSignature(shingles);
      this.signatures.set(fileName, signature);
      if (++signatureCount % 10 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
    console.log(this.signatures);
    console.log("xxx")

    // Banding
    this.candidatePairs = this.findCandidatePairs(this.signatures);
    console.error(`Candidates count: ${this.candidatePairs.length}`)
    for (let pair of this.candidatePairs) {
      console.log(`${pair}`)
      const exist0 = this.relatedNotes.get(pair[0]) || [];
      // TODO(olu): Clean up cast.
      exist0.push(this.nameToTFile.get(pair[1])!)
      const exist1 = this.relatedNotes.get(pair[1]) || [];
      exist1.push(this.nameToTFile.get(pair[0])!)
      this.relatedNotes.set(pair[0], exist0);
      this.relatedNotes.set(pair[1], exist1);
    }
  }

  private async createSignature(shingles: Set<string>): Promise<number[]> {
    const signature: number[] = [];
    let hashCount = 0;

    for (const hashFunc of this.minhashFunctions) {
      for (let i = 1; i <= this.vocabulary.length; i++) {
        const idx = hashFunc.indexOf(i);
        const shingle = this.vocabulary[idx];
        if (shingles.has(shingle)) {
          signature.push(idx);
          break;
        }
      }
      // Yield every 20 hash functions
      if (++hashCount % 20 === 0) {
        await new Promise(resolve => setTimeout(resolve, 0));
        console.log("yielding hash count");
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
    console.log(signatures.size)
    console.log(signatures)
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

    console.log(bandBuckets)

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
    console.debug("cleanup");
  }

  async generateVector(text: string): Promise<number[] | Map<number, number>> {
    console.debug("generate vector");
    return [];
  }

  clear() { }

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

  /**
   * Computes cosine similarity between two TFiles using frequency-capped bag of words vectors.
   * The frequency of each term is capped to reduce the impact of very frequent terms.
   * @param file1 First TFile to compare
   * @param file2 Second TFile to compare
   * @param freqCap Maximum frequency cap for any term (default: 20)
   * @returns Promise containing the cosine similarity score between 0 and 1
   */
  async computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo> {
    try {
      // Read and tokenize both files
      const content1 = await this.vault.cachedRead(file1);
      const content2 = await this.vault.cachedRead(file2);

      const tokens1 = tokenize(content1).split(' ');
      const tokens2 = tokenize(content2).split(' ');

      // Create frequency maps with capping
      const freqMap1 = new Map<string, number>();
      const freqMap2 = new Map<string, number>();

      // Count frequencies for file1
      for (const token of tokens1) {
        const currentFreq = freqMap1.get(token) || 0;
        if (currentFreq < FREQUENCY_CAP) {
          freqMap1.set(token, currentFreq + 1);
        }
        // Yield every 1000 tokens
        // if (processedTokens++ % 1000 === 0) {
        //   await new Promise(resolve => setTimeout(resolve, 0));
        // }
      }

      // Count frequencies for file2
      for (const token of tokens2) {
        const currentFreq = freqMap2.get(token) || 0;
        if (currentFreq < FREQUENCY_CAP) {
          freqMap2.set(token, currentFreq + 1);
        }
      }

      // Get unique terms from both documents
      const uniqueTerms = new Set([...freqMap1.keys(), ...freqMap2.keys()]);

      // Compute vectors and similarity
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

      // Compute cosine similarity
      if (norm1 === 0 || norm2 === 0) return {
        similarity: 0,
      };

      return {
        similarity: dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2)),
      };

    } catch (error) {
      console.error('Error computing capped cosine similarity:', error);
      return {
        similarity: 0,
      };
    }
  }
}
