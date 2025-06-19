/**
 * @file Fast word-based inverted index for candidate selection
 * Implements random word sampling for sub-second similarity search
 */

import { TFile } from 'obsidian';
import { tokenize } from './core';
import { logIfDebugModeEnabled } from './logging';
import { WORD_INDEX } from './constants';

/**
 * Fast word-based inverted index for candidate selection
 * Uses random word sampling to quickly find potential similar documents
 */
export class WordBasedCandidateSelector {
  // Global word index: word -> Set of document paths containing that word
  private wordIndex = new Map<string, Set<string>>();
  
  // Document word cache: document path -> Set of words in that document
  private documentWords = new Map<string, Set<string>>();
  
  // Statistics
  private totalDocuments = 0;
  private totalWords = 0;
  
  /**
   * Add a document to the word index
   * @param docPath Document path
   * @param text Document content
   */
  addDocument(docPath: string, text: string): void {
    // Remove existing document if it was already indexed
    this.removeDocument(docPath);
    
    // Extract and normalize words
    const processed = tokenize(text);
    const words = this.extractMeaningfulWords(processed);
    
    // Store document words
    this.documentWords.set(docPath, words);
    
    // Add to inverted index
    for (const word of words) {
      if (!this.wordIndex.has(word)) {
        this.wordIndex.set(word, new Set());
      }
      this.wordIndex.get(word)!.add(docPath);
    }
    
    this.totalDocuments++;
    this.totalWords += words.size;
    
    logIfDebugModeEnabled(`Added document ${docPath} with ${words.size} unique words to word index`);
  }
  
  /**
   * Remove a document from the word index
   * @param docPath Document path to remove
   */
  removeDocument(docPath: string): void {
    const words = this.documentWords.get(docPath);
    if (!words) return;
    
    // Remove from inverted index
    for (const word of words) {
      const docsWithWord = this.wordIndex.get(word);
      if (docsWithWord) {
        docsWithWord.delete(docPath);
        // Remove word entry if no documents contain it
        if (docsWithWord.size === 0) {
          this.wordIndex.delete(word);
        }
      }
    }
    
    // Remove from document cache
    this.documentWords.delete(docPath);
    this.totalDocuments = Math.max(0, this.totalDocuments - 1);
    
    logIfDebugModeEnabled(`Removed document ${docPath} from word index`);
  }
  
  /**
   * Get fast candidates using random word sampling
   * @param queryDocPath Path of query document
   * @param maxCandidates Maximum number of candidates to return
   * @param numSampleWords Number of random words to sample (default from constants)
   * @returns Array of candidate document paths
   */
  getFastCandidates(queryDocPath: string, maxCandidates: number = WORD_INDEX.DEFAULT_MAX_CANDIDATES, numSampleWords: number = WORD_INDEX.DEFAULT_SAMPLE_WORDS): string[] {
    const queryWords = this.documentWords.get(queryDocPath);
    if (!queryWords || queryWords.size === 0) {
      logIfDebugModeEnabled(`No words found for query document ${queryDocPath}`);
      return [];
    }
    
    const candidates = new Map<string, number>(); // docPath -> score (number of matching words)
    const wordsArray = Array.from(queryWords);
    
    // Sample random words from the query document
    const sampleWords = this.sampleRandomWords(wordsArray, numSampleWords);
    
    if (sampleWords.length === 0) {
      logIfDebugModeEnabled(`No sample words available for ${queryDocPath}`);
      return [];
    }
    
    logIfDebugModeEnabled(`Sampling ${sampleWords.length} words for fast candidate selection: ${sampleWords.join(', ')}`);
    
    // For each sampled word, find documents containing it
    for (const word of sampleWords) {
      const docsWithWord = this.wordIndex.get(word);
      if (docsWithWord) {
        for (const docPath of docsWithWord) {
          if (docPath !== queryDocPath) { // Exclude self
            const currentScore = candidates.get(docPath) || 0;
            candidates.set(docPath, currentScore + 1);
          }
        }
      }
    }
    
    // Sort candidates by score (number of matching words) and return top N
    const sortedCandidates = Array.from(candidates.entries())
      .sort((a, b) => b[1] - a[1]) // Sort by score descending
      .slice(0, maxCandidates)
      .map(([docPath]) => docPath);
    
    logIfDebugModeEnabled(`Found ${sortedCandidates.length} fast candidates for ${queryDocPath} using word sampling`);
    
    return sortedCandidates;
  }
  
  /**
   * Get candidates that share specific words with the query
   * @param queryDocPath Path of query document
   * @param specificWords Array of specific words to search for
   * @param maxCandidates Maximum candidates to return
   * @returns Array of candidate document paths
   */
  getCandidatesForWords(queryDocPath: string, specificWords: string[], maxCandidates: number = 100): string[] {
    const candidates = new Set<string>();
    
    for (const word of specificWords) {
      const docsWithWord = this.wordIndex.get(word);
      if (docsWithWord) {
        for (const docPath of docsWithWord) {
          if (docPath !== queryDocPath && candidates.size < maxCandidates) {
            candidates.add(docPath);
          }
        }
      }
    }
    
    return Array.from(candidates);
  }
  
  /**
   * Get the most common words in the corpus
   * @param limit Number of words to return
   * @returns Array of [word, documentCount] pairs
   */
  getMostCommonWords(limit: number = 50): Array<[string, number]> {
    const wordCounts = Array.from(this.wordIndex.entries())
      .map(([word, docs]) => [word, docs.size] as [string, number])
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit);
    
    return wordCounts;
  }
  
  /**
   * Extract meaningful words from processed text
   * Filters out very common and very rare words
   * @param processed Tokenized text
   * @returns Set of meaningful words
   */
  private extractMeaningfulWords(processed: string): Set<string> {
    const words = processed.toLowerCase().split(/\s+/);
    const meaningfulWords = new Set<string>();
    
    for (const word of words) {
      // Skip very short words
      if (word.length < 3) continue;
      
      // Skip words that are too long (likely to be noise)
      if (word.length > 20) continue;
      
      // Skip words with too many special characters
      if ((word.match(/[^a-z0-9]/g) || []).length > word.length * 0.3) continue;
      
      // Skip purely numeric words unless they're significant
      if (/^\d+$/.test(word) && word.length < 4) continue;
      
      meaningfulWords.add(word);
    }
    
    // For new documents, add all meaningful words first
    // We'll apply document frequency filtering later when we have more data
    if (this.totalDocuments < 10) {
      return meaningfulWords;
    }
    
    // Additional filtering: remove words that appear in too many documents (stop words)
    const filtered = new Set<string>();
    for (const word of meaningfulWords) {
      const docCount = this.wordIndex.get(word)?.size || 0;
      const documentRatio = this.totalDocuments > 0 ? docCount / this.totalDocuments : 0;
      
      // Skip words that appear in more than threshold% of documents (too common)
      if (documentRatio > WORD_INDEX.DOCUMENT_FREQUENCY_THRESHOLD) continue;
      
      // Skip words that appear in only 1 document if we have many documents (too rare)
      if (this.totalDocuments > 100 && docCount < WORD_INDEX.MIN_DOCUMENT_COUNT_LARGE_CORPUS) continue;
      
      filtered.add(word);
    }
    
    // If filtering removed all words, return the original set
    return filtered.size > 0 ? filtered : meaningfulWords;
  }
  
  /**
   * Sample random words from an array
   * @param words Array of words to sample from
   * @param numSamples Number of samples to take
   * @returns Array of sampled words
   */
  private sampleRandomWords(words: string[], numSamples: number): string[] {
    if (words.length <= numSamples) {
      return [...words]; // Return all words if we have fewer than requested
    }
    
    const sampled: string[] = [];
    const used = new Set<number>();
    
    while (sampled.length < numSamples && used.size < words.length) {
      const randomIndex = Math.floor(Math.random() * words.length);
      if (!used.has(randomIndex)) {
        used.add(randomIndex);
        sampled.push(words[randomIndex]);
      }
    }
    
    return sampled;
  }
  
  /**
   * Clear the entire index
   */
  clear(): void {
    this.wordIndex.clear();
    this.documentWords.clear();
    this.totalDocuments = 0;
    this.totalWords = 0;
    logIfDebugModeEnabled('Cleared word-based candidate selector');
  }
  
  /**
   * Get statistics about the word index
   */
  getStats(): any {
    return {
      totalDocuments: this.totalDocuments,
      totalUniqueWords: this.wordIndex.size,
      totalWordOccurrences: this.totalWords,
      averageWordsPerDocument: this.totalDocuments > 0 ? this.totalWords / this.totalDocuments : 0,
      averageDocumentsPerWord: this.wordIndex.size > 0 ? 
        Array.from(this.wordIndex.values()).reduce((sum, docs) => sum + docs.size, 0) / this.wordIndex.size : 0
    };
  }
  
  /**
   * Check if a document is indexed
   * @param docPath Document path
   * @returns True if document is in the index
   */
  isDocumentIndexed(docPath: string): boolean {
    return this.documentWords.has(docPath);
  }
  
  /**
   * Get all documents that contain a specific word
   * @param word Word to search for
   * @returns Array of document paths containing the word
   */
  getDocumentsContainingWord(word: string): string[] {
    const docs = this.wordIndex.get(word.toLowerCase());
    return docs ? Array.from(docs) : [];
  }
}