/**
 * @file Core functionality for the Related Notes plugin including UI components and embedding providers.
 * Implements the view for displaying related notes and the embedding providers for calculating note similarity.
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView, MarkdownRenderer } from 'obsidian';
import RelatedNotesPlugin from './main';
import { Logger } from './logger';
import { AlgorithmConfig, DEFAULT_CONFIG } from './config';

// UI Components
export const RELATED_NOTES_VIEW_TYPE = 'related-notes-view';

/**
 * View component that displays related notes in a side panel.
 * Handles rendering of related notes and provides interaction capabilities like adding links.
 */
export class RelatedNotesView extends ItemView {
  plugin: RelatedNotesPlugin;
  currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatedNotesPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Related Notes';
  }

  private setLoading(loading: boolean) {
    const container = this.containerEl.children[1];
    if (!container) return;

    const existingLoader = container.querySelector('.related-notes-loading');
    if (loading && !existingLoader) {
      const loader = container.createDiv({ cls: 'related-notes-loading' });
      loader.textContent = 'Indexing notes...';
    } else if (!loading && existingLoader) {
      existingLoader.remove();
    }
  }

  public async onOpen() {
    if (!this.containerEl.children[1]) {
      this.containerEl.createDiv();
    }
    const container = this.containerEl.children[1];
    container.empty();
    this.containerEl.addClass('related-notes-container');
    container.createEl('h4', { text: 'Related Notes' });
    container.createDiv({ cls: 'related-notes-content' });
  }

  public async onClose() {
    this.containerEl.empty();
    this.containerEl.removeClass('related-notes-container');
    this.currentFile = null;
  }

  private hasExistingLink(content: string, targetBasename: string): boolean {
    // Check for links in the entire document
    if (content.includes(`[[${targetBasename}]]`)) {
      return true;
    }

    // Also check in the Related Notes section for backward compatibility
    const relatedSectionRegex = /\n## Related Notes\n([\s\S]*?)(\n#|$)/;
    const match = content.match(relatedSectionRegex);
    return match ? match[1].includes(`[[${targetBasename}]]`) : false;
  }

  public async updateForFile(file: TFile | null, relatedNotes: Array<{ file: TFile; similarity: number; topWords: string[] }>, isIndexing?: boolean) {
    const fragment = document.createDocumentFragment();
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    this.currentFile = file;

    this.setLoading(isIndexing || false);

    // Prepare content based on file state
    if (!file) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      messageEl.createEl('p', {
        text: 'Open a markdown file to see related notes.',
        cls: 'related-notes-message-text'
      });
    } else if (!this.plugin.isMarkdownFile(file)) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      messageEl.createEl('p', {
        text: 'Related notes are only available for markdown files.',
        cls: 'related-notes-message-text'
      });
      messageEl.createEl('p', {
        text: `Current file type: ${file.extension.toUpperCase()}`,
        cls: 'related-notes-message-subtext'
      });
    } else if (!relatedNotes.length) {
      contentEl.createEl('p', { text: 'No related notes found.' });
    } else {
      const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });
      const currentContent = await this.app.vault.cachedRead(file);

      const listItems = await Promise.all(relatedNotes.map(async ({ file: relatedFile, similarity, topWords }) => {
        const listItemEl = document.createElement('li');
        listItemEl.className = 'related-note-item';

        const linkContainer = document.createElement('div');
        linkContainer.className = 'related-note-link-container';

        // Create title link
        const linkEl = document.createElement('a');
        linkEl.className = 'related-note-link';
        linkEl.textContent = relatedFile.basename;
        linkContainer.appendChild(linkEl);

        if (this.plugin.settings.debugMode) {
          const similaritySpan = document.createElement('span');
          similaritySpan.className = 'related-note-similarity';
          similaritySpan.textContent = ` (${(similarity * 100).toFixed(2)}%)`;
          linkContainer.appendChild(similaritySpan);
        }

        listItemEl.appendChild(linkContainer);

        // Add hashtags if available
        if (topWords && topWords.length > 0) {
          const hashtagsContainer = document.createElement('div');
          hashtagsContainer.className = 'related-note-hashtags';

          topWords.forEach(word => {
            const hashtag = document.createElement('span');
            hashtag.className = 'related-note-hashtag';
            hashtag.textContent = `#${word}`;
            hashtag.addEventListener('click', (e) => {
              e.preventDefault();
              e.stopPropagation();
              // Trigger search for this word
              const searchLeaf = this.app.workspace.getLeavesOfType('search')[0] ||
                this.app.workspace.getRightLeaf(false);
              this.app.workspace.revealLeaf(searchLeaf);
              searchLeaf.setViewState({
                type: 'search',
                state: { query: word }
              });
            });
            hashtagsContainer.appendChild(hashtag);
          });

          listItemEl.appendChild(hashtagsContainer);
        }

        // Add event listener for link click
        linkEl.addEventListener('click', async (e) => {
          e.preventDefault();
          await this.app.workspace.getLeaf().openFile(relatedFile);
        });

        return listItemEl;
      }));

      // Append all items to the list at once
      listItems.forEach(item => listEl.appendChild(item));
    }

    // Replace the old content with the new fragment in a single operation
    const container = this.containerEl.children[1] || this.containerEl.createDiv();
    container.empty();
    container.appendChild(fragment);
  }
}

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
  generateVector(text: string): Promise<number[]>;
  calculateSimilarity(vec1: number[], vec2: number[]): { similarity: number; topWords: string[] };
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
class WordTokenizer {
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
        );
    } catch (error) {
      Logger.error('Error during tokenization:', error);
      return [];
    }
  }
}

interface DocumentEntry {
  path: string;
  tokens: string[];
  mtime: number;
  length: number;
}

/**
 * Implementation of the BM25 (Best Matching 25) ranking algorithm.
 * Provides document scoring based on term frequency and inverse document frequency.
 */
export class BM25 {
  private documents: Map<string, DocumentEntry>;
  private documentCount: { [term: string]: number };
  private totalDocuments: number;
  private isDirty: boolean;
  private avgDocLength: number;
  private k1: number;
  private b: number;
  vocabulary: Map<string, number>; // Maps terms to their fixed position in vectors
  private nextTermIndex: number;

  constructor(config: { k1: number; b: number } = DEFAULT_CONFIG.bm25) {
    this.documents = new Map();
    this.documentCount = {};
    this.totalDocuments = 0;
    this.isDirty = false;
    this.avgDocLength = 0;
    this.k1 = config.k1;
    this.b = config.b;
    this.vocabulary = new Map();
    this.nextTermIndex = 0;
  }

  private updateAvgDocLength() {
    if (this.totalDocuments === 0) {
      this.avgDocLength = 0;
      return;
    }
    let totalLength = 0;
    this.documents.forEach(doc => totalLength += doc.length);
    this.avgDocLength = totalLength / this.totalDocuments;
  }

  private getOrAddTermIndex(term: string): number {
    let index = this.vocabulary.get(term);
    if (index === undefined) {
      index = this.nextTermIndex++;
      this.vocabulary.set(term, index);
    }
    return index;
  }

  addDocument(path: string, tokens: string[], mtime: number) {
    const existingDoc = this.documents.get(path);
    if (existingDoc) {
      const oldUniqueTerms = new Set(existingDoc.tokens);
      oldUniqueTerms.forEach(term => {
        this.documentCount[term]--;
        if (this.documentCount[term] === 0) delete this.documentCount[term];
      });
      this.totalDocuments--;
    }

    // Add all new terms to vocabulary first
    tokens.forEach(term => this.getOrAddTermIndex(term));

    this.documents.set(path, { path, tokens, mtime, length: tokens.length });
    this.totalDocuments++;

    const uniqueTerms = new Set(tokens);
    uniqueTerms.forEach(term => {
      this.documentCount[term] = (this.documentCount[term] || 0) + 1;
    });

    this.updateAvgDocLength();
    this.isDirty = true;
  }

  removeDocument(path: string) {
    const doc = this.documents.get(path);
    if (!doc) return;

    const uniqueTerms = new Set(doc.tokens);
    uniqueTerms.forEach(term => {
      this.documentCount[term]--;
      if (this.documentCount[term] === 0) delete this.documentCount[term];
    });

    this.documents.delete(path);
    this.totalDocuments--;
    this.updateAvgDocLength();
    this.isDirty = true;
  }

  clear() {
    this.documents.clear();
    this.documentCount = {};
    this.totalDocuments = 0;
    this.avgDocLength = 0;
    this.isDirty = true;
    // Keep vocabulary to maintain consistent vector positions
  }

  private termFrequency(term: string, doc: DocumentEntry): number {
    return doc.tokens.filter(t => t === term).length;
  }

  private idf(term: string): number {
    const docFreq = this.documentCount[term] || 0;
    if (docFreq === 0) return 0;
    return Math.log(1 + (this.totalDocuments - docFreq + 0.5) / (docFreq + 0.5));
  }

  calculateVector(path: string): number[] | null {
    const doc = this.documents.get(path);
    if (!doc) return null;

    // Initialize vector with zeros for all known terms
    const vector = new Array(this.nextTermIndex).fill(0);

    // Calculate BM25 score for each term in the document
    const uniqueTerms = new Set(doc.tokens);
    uniqueTerms.forEach(term => {
      const termIndex = this.vocabulary.get(term);
      if (termIndex !== undefined) {
        const tf = this.termFrequency(term, doc);
        const idf = this.idf(term);
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (doc.length / this.avgDocLength));
        vector[termIndex] = idf * (numerator / denominator);
      }
    });

    return vector;
  }
}

/**
 * Provider that uses the BM25 algorithm for document similarity.
 * Optimized for keyword-based matching and fast local processing.
 * Best suited for small to medium-sized vaults.
 */
export class BM25Provider implements SimilarityProvider {
  name = 'BM25';
  description = 'Classic BM25 algorithm for fast keyword-based similarity';
  private bm25: BM25;
  private tokenizer: WordTokenizer;

  get vocabulary(): Map<string, number> {
    return this.bm25.vocabulary;
  }

  constructor() {
    this.bm25 = new BM25(DEFAULT_CONFIG.bm25);
    this.tokenizer = new WordTokenizer();
  }

  async initialize(): Promise<void> { }

  async cleanup(path?: string): Promise<void> {
    if (path) {
      this.bm25.removeDocument(path);
    } else {
      this.bm25.clear();
    }
  }

  async generateVector(text: string): Promise<number[]> {
    const tokens = this.tokenizer.tokenize(text, {
      minLength: 2,
      removeStopWords: true,
      handleContractions: true
    });
    this.bm25.addDocument('temp', tokens, Date.now());
    const vector = this.bm25.calculateVector('temp') || [];
    this.bm25.removeDocument('temp');
    return vector;
  }

  calculateSimilarity(vec1: number[], vec2: number[]): { similarity: number; topWords: string[] } {
    if (vec1.length !== vec2.length) {
      throw new Error(`Vectors must have the same length. Got ${vec1.length} and ${vec2.length}`);
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;
    const contributions: { word: string; contribution: number }[] = [];

    for (let i = 0; i < vec1.length; i++) {
      const contribution = vec1[i] * vec2[i];
      dotProduct += contribution;
      norm1 += vec1[i] * vec1[i];
      norm2 += vec2[i] * vec2[i];

      // Get the word for this vector position
      for (const [word, index] of this.vocabulary.entries()) {
        if (index === i && contribution > 0) {
          contributions.push({ word, contribution });
          break;
        }
      }
    }

    if (norm1 === 0 || norm2 === 0) return { similarity: 0, topWords: [] };

    const similarity = dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
    const topWords = contributions
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, 2)
      .map(c => c.word);

    return { similarity, topWords };
  }
}

/**
 * Provider that combines MinHash LSH with BM25 for efficient large-scale similarity detection.
 * Uses a three-stage approach: LSH for fast candidate retrieval, MinHash for efficient 
 * similarity estimation, and BM25 for term-frequency based scoring.
 * Recommended for large vaults (>10,000 notes) due to sub-linear search time.
 */
export class MinHashLSHProvider implements SimilarityProvider {
  name = 'minhash-lsh';
  description = 'MinHash LSH + BM25 for efficient large-scale similarity detection';
  private similarity: MinHashLSHEngine;
  private bm25: BM25;
  private tokenizer: WordTokenizer;

  constructor() {
    this.similarity = new MinHashLSHEngine(DEFAULT_CONFIG);
    this.bm25 = new BM25(DEFAULT_CONFIG.bm25);
    this.tokenizer = new WordTokenizer();
  }

  async initialize(): Promise<void> {
  }

  async cleanup(path?: string): Promise<void> {
    if (path) {
      this.similarity.documents.delete(path);
      this.similarity.documentLengths.delete(path);
      this.similarity.signatures.delete(path);
      for (const [hash, docs] of this.similarity.lshIndex) {
        docs.delete(path);
        if (docs.size === 0) {
          this.similarity.lshIndex.delete(hash);
        }
      }
      this.bm25.removeDocument(path);
    } else {
      this.similarity = new MinHashLSHEngine(DEFAULT_CONFIG);
      this.bm25.clear();
    }
  }

  async generateVector(text: string): Promise<number[]> {
    try {
      const tokens = this.tokenizer.tokenize(text, {
        minLength: 2,
        removeStopWords: true,
        handleContractions: true
      });

      // Generate MinHash signature for LSH-based filtering
      const tempId = 'temp_' + Date.now();
      this.similarity.addDocument(tempId, text);
      const signature = this.similarity.signatures.get(tempId);
      if (!signature) throw new Error('Failed to generate MinHash signature');

      // Generate BM25 vector for scoring
      this.bm25.addDocument(tempId, tokens, Date.now());
      const bm25Vector = this.bm25.calculateVector(tempId) || [];

      // Cleanup temporary documents
      this.similarity.documents.delete(tempId);
      this.similarity.documentLengths.delete(tempId);
      this.similarity.signatures.delete(tempId);
      this.bm25.removeDocument(tempId);

      // Store both vectors for later use
      return {
        type: 'temp',
        minhash: signature,
        bm25: bm25Vector
      } as any; // Using any to maintain interface compatibility

    } catch (error) {
      Logger.error('Error generating vectors:', error);
      throw error;
    }
  }

  calculateSimilarity(vec1: any, vec2: any): { similarity: number; topWords: string[] } {
    // For temporary vectors (during search), use BM25 similarity
    if (vec1.type === 'temp' || vec2.type === 'temp') {
      const bm251 = vec1.type === 'temp' ? vec1.bm25 : vec1;
      const bm252 = vec2.type === 'temp' ? vec2.bm25 : vec2;

      // Calculate BM25 cosine similarity with word contributions
      let dotProduct = 0;
      let norm1 = 0;
      let norm2 = 0;
      const contributions: { word: string; contribution: number }[] = [];

      for (let i = 0; i < bm251.length; i++) {
        const contribution = bm251[i] * bm252[i];
        dotProduct += contribution;
        norm1 += bm251[i] * bm251[i];
        norm2 += bm252[i] * bm252[i];

        // Get the word for this vector position
        for (const [word, index] of this.bm25.vocabulary.entries()) {
          if (index === i && contribution > 0) {
            contributions.push({ word, contribution });
            break;
          }
        }
      }

      const similarity = norm1 === 0 || norm2 === 0 ? 0 :
        dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));

      const topWords = contributions
        .sort((a, b) => b.contribution - a.contribution)
        .slice(0, 2)
        .map(c => c.word);

      return { similarity, topWords };
    }

    // For LSH filtering (between stored vectors), use MinHash similarity
    const minhash1 = vec1.slice(0, this.similarity.numHashes);
    const minhash2 = vec2.slice(0, this.similarity.numHashes);

    let matches = 0;
    for (let i = 0; i < this.similarity.numHashes; i++) {
      if (minhash1[i] === minhash2[i]) matches++;
    }
    return {
      similarity: matches / this.similarity.numHashes,
      topWords: [] // MinHash doesn't provide word-level contributions
    };
  }
}

/**
 * Core engine for MinHash LSH similarity calculations.
 * Implements LSH (Locality-Sensitive Hashing) and MinHash techniques for sub-linear
 * time similarity search, combined with BM25 scoring for accurate results.
 * Maintains efficient index structures and caches for optimal performance.
 */
export class MinHashLSHEngine {
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
  lshIndex: Map<number, Set<string>>;
  private numBands: number;
  private bandSize: number;
  private vocabulary: Map<string, number>; // Maps terms to their fixed position in vectors
  private nextTermIndex: number;

  private readonly tokenizer: WordTokenizer = new WordTokenizer();

  constructor(config: AlgorithmConfig = DEFAULT_CONFIG) {
    this.numHashes = config.minHash.numHashes;
    this.k1 = config.bm25.k1;
    this.b = config.bm25.b;
    this.titleWeight = config.minhashLsh.titleWeight;
    this.fuzzyDistance = config.minHash.fuzzyDistance;
    this.documents = new Map();
    this.documentLengths = new Map();
    this.averageDocLength = 0;
    this.termFrequencies = new Map();
    this.documentFrequencies = new Map();
    this.signatures = new Map();
    this.numBands = config.minHash.numBands;
    this.bandSize = config.minHash.bandSize;
    this.hashFunctions = this.generateHashFunctions();
    this.lshIndex = new Map();
    this.vocabulary = new Map();
    this.nextTermIndex = 0;
  }

  private getOrAddTermIndex(term: string): number {
    let index = this.vocabulary.get(term);
    if (index === undefined) {
      index = this.nextTermIndex++;
      this.vocabulary.set(term, index);
    }
    return index;
  }

  preprocess(text: string): { title: string[]; content: string[] } {
    const lines = text.split('\n');
    let title: string[] = [];
    let content: string[] = [];

    const titleMatch = lines.find(line => line.startsWith('# '));
    if (titleMatch) {
      title = this.tokenize(titleMatch.replace(/^#\s+/, ''));
    }

    content = this.tokenize(text);

    // Add all tokens to vocabulary to maintain consistent positions
    [...new Set([...title, ...content])].forEach(term => this.getOrAddTermIndex(term));

    return { title, content };
  }

  private tokenize(text: string): string[] {
    return this.tokenizer.tokenize(text, {
      minLength: 2,
      removeStopWords: true,
      handleContractions: true
    });
  }

  async addDocument(docId: string, text: string): Promise<void> {
    const { title, content } = this.preprocess(text);
    this.documents.set(docId, { title, content });

    // Update term frequencies and document frequencies
    const uniqueTerms = new Set([...title, ...content]);
    uniqueTerms.forEach(term => {
      const termIndex = this.getOrAddTermIndex(term);

      // Update document frequency
      this.documentFrequencies.set(term, (this.documentFrequencies.get(term) || 0) + 1);

      // Update term frequency
      if (!this.termFrequencies.has(docId)) {
        this.termFrequencies.set(docId, new Map());
      }
      const docTerms = this.termFrequencies.get(docId)!;
      docTerms.set(term, (docTerms.get(term) || 0) + 1);
    });

    // Calculate and store MinHash signature
    const signature = this.calculateMinHash(uniqueTerms);
    this.signatures.set(docId, signature);
    await this.indexLSH(docId, signature);

    // Update document length
    this.documentLengths.set(docId, content.length);
    this.updateAverageDocLength();
  }

  private updateAverageDocLength() {
    if (this.documentLengths.size === 0) {
      this.averageDocLength = 0;
      return;
    }
    let totalLength = 0;
    this.documentLengths.forEach(length => totalLength += length);
    this.averageDocLength = totalLength / this.documentLengths.size;
  }

  generateVector(text: string): number[] {
    const { title, content } = this.preprocess(text);
    const uniqueTerms = new Set([...title, ...content]);

    // Generate MinHash signature
    const minhashSignature = this.calculateMinHash(uniqueTerms);

    // Generate BM25-like vector with fixed positions
    const bm25Vector = new Array(this.vocabulary.size).fill(0);
    uniqueTerms.forEach(term => {
      const termIndex = this.vocabulary.get(term);
      if (termIndex !== undefined) {
        const tf = [...content, ...title].filter(t => t === term).length;
        const df = this.documentFrequencies.get(term) || 1;
        const idf = Math.log(1 + (this.documents.size - df + 0.5) / (df + 0.5));
        const docLength = content.length;

        // BM25-like scoring
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * (1 - this.b + this.b * (docLength / this.averageDocLength));
        bm25Vector[termIndex] = idf * (numerator / denominator);
      }
    });

    // Combine MinHash signature with BM25 vector
    return [...minhashSignature, ...bm25Vector];
  }

  private async indexLSH(docId: string, signature: number[]): Promise<void> {
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
}
