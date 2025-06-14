/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
* Includes smart caching to improve performance and reduce token usage.
*/

import { Vault, TFile, normalizePath } from 'obsidian';
import { BloomFilter, BloomFilterSimilarityProvider } from './bloom';

'use strict';

const FREQUENCY_CAP = 10;
const CACHE_VERSION = 1;

export interface RelatedNote {
  file: TFile;
  similarity: number;
  isPreIndexed?: boolean; // Whether this note was pre-indexed
}

export interface SimilarityInfo {
  similarity: number;
}

export interface SimilarityProvider {
  // Core initialization and indexing
  initialize(onProgress?: (processed: number, total: number) => void): Promise<void>;
  forceReindex(onProgress: (processed: number, total: number) => void): Promise<void>;
  stop(): void;
  
  // File operations
  isFileIndexed(file: TFile): boolean;
  
  // Document processing
  processDocument(docId: string, text: string): Promise<void>;
  
  // Similarity computation
  getCandidateFiles(file: TFile): TFile[];
  computeCappedCosineSimilarity(file1: TFile, file2: TFile): Promise<SimilarityInfo>;
  
  // Stats and metadata
  getStats(): any;
}

export interface CacheData {
  version: number;
  lastUpdated: number;
  fileVectors: Record<string, string[]>;
  signatures: Record<string, number[]>;
  relatedNotes: Record<string, string[]>;
  fileMetadata: Record<string, { mtime: number; size: number }>;
}

/**
 * Enhanced tokenization function that processes text into meaningful terms
 * Handles CJK scripts, contractions, possessives, stop words, and special characters
 * Preserves technical terms, code identifiers, and domain-specific vocabulary
 */
export function tokenize(text: string): string {
  if (!text) return '';

  // Expanded stop words list
  const stopWords = new Set([
    // Articles
    'a', 'an', 'the',
    // Prepositions
    'in', 'on', 'at', 'with', 'by', 'from', 'to', 'for', 'of', 'about', 'as',
    'into', 'over', 'under', 'above', 'below', 'between', 'among', 'through',
    // Conjunctions
    'and', 'but', 'or', 'nor', 'so', 'yet', 'after', 'although', 'because',
    // Common verbs
    'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall', 'should',
    'can', 'could', 'may', 'might', 'must',
    // Pronouns
    'i', 'me', 'my', 'mine', 'myself',
    'you', 'your', 'yours', 'yourself',
    'he', 'him', 'his', 'himself',
    'she', 'her', 'hers', 'herself',
    'it', 'its', 'itself',
    'we', 'us', 'our', 'ours', 'ourselves',
    'they', 'them', 'their', 'theirs', 'themselves',
    'this', 'that', 'these', 'those',
    // Other common words
    'what', 'which', 'who', 'whom', 'whose',
    'when', 'where', 'why', 'how',
    'all', 'any', 'both', 'each', 'few', 'more', 'most', 'some',
    'no', 'not', 'only', 'than', 'too', 'very'
  ]);

  // More comprehensive contractions handling
  const contractions = new Map([
    // Negations
    ["n't", " not"],
    // Verb forms
    ["'re", " are"], ["'m", " am"], ["'s", " is"], ["'ve", " have"],
    ["'d", " would"], ["'ll", " will"],
    // Special cases
    ["'clock", " oclock"], ["o'clock", "oclock"],
    ["'cause", " because"], ["'n'", " and "],
    // Possessives - preserve the base word
    ["s'", "s"], ["s's", "s"]
  ]);

  try {
    // Step 1: Preserve code identifiers and technical terms
    // Replace code blocks with placeholders
    const codeBlocks: string[] = [];
    let codeBlockCounter = 0;

    // Replace inline code and code blocks with placeholders
    let processed = text.replace(/`([^`]+)`|```[\s\S]+?```/g, (match) => {
      const placeholder = `__CODE_BLOCK_${codeBlockCounter}__`;
      codeBlocks.push(match);
      codeBlockCounter++;
      return placeholder;
    });

    // Step 2: Handle URLs and file paths - preserve them
    const urls: string[] = [];
    let urlCounter = 0;
    processed = processed.replace(/https?:\/\/[^\s]+|file:\/\/[^\s]+|[\w\/\.-]+\.(md|txt|js|ts|html|css|json|py|java|rb|c|cpp|h|go|rs|php)/g, (match) => {
      const placeholder = `__URL_${urlCounter}__`;
      urls.push(match);
      urlCounter++;
      return placeholder;
    });

    // Step 3: Handle contractions
    processed = processed.replace(
      new RegExp(Object.keys(contractions).join('|'), 'g'),
      match => contractions.get(match) || match
    );

    // Step 4: Detect script type (CJK vs Latin/others)
    const hasCJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(processed);

    // Step 5: Process based on script type
    let tokens: string[] = [];
    
    if (hasCJK) {
      // CJK processing - handle characters individually or in small groups
      // First normalize for consistency
      processed = processed.normalize('NFC').toLowerCase();
      
      // Split CJK characters for individual processing
      // This regex pattern keeps CJK characters separate while preserving Latin words
      const cjkPattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]|[a-z0-9_\-]+/g;
      
      // Extract all matches
      const matches = processed.match(cjkPattern) || [];
      
      // Filter short terms and stop words
      tokens = matches.filter(term => {
        // For CJK individual characters, accept all
        if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/.test(term)) {
          return true;
        }
        // For Latin script words, apply standard filtering
        return term.length > 2 && !stopWords.has(term);
      });
      
      // Also add character pairs for better context (bigrams of CJK characters)
      const cjkChars = processed.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g) || [];
      for (let i = 0; i < cjkChars.length - 1; i++) {
        tokens.push(cjkChars[i] + cjkChars[i + 1]);
      }
    } else {
      // Standard Latin script processing
      processed = processed.toLowerCase()
        // Keep hyphens and underscores for compound words and code identifiers
        .replace(/[^\w\s\-_]/g, ' ')
        // Convert multiple spaces to single space
        .replace(/\s+/g, ' ');

      // Split into words, filter stop words and short terms
      tokens = processed.split(/\s+/)
        .filter(word => word.length > 2 && !stopWords.has(word));

      // Simple stemming for common suffixes (only for Latin script)
      tokens = tokens.map(word => {
        // Skip URLs, code blocks, and technical terms
        if (word.includes('/') || word.includes('.') ||
          word.includes('_') || word.includes('-')) {
          return word;
        }

        // Simple stemming rules
        if (word.endsWith('ing') && word.length > 5) return word.slice(0, -3);
        if (word.endsWith('ed') && word.length > 4) return word.slice(0, -2);
        if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) return word.slice(0, -1);
        if (word.endsWith('es') && word.length > 4) return word.slice(0, -2);
        if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y';
        if (word.endsWith('ly') && word.length > 4) return word.slice(0, -2);
        return word;
      });
    }

    // Step 6: Restore code blocks and URLs
    tokens = tokens.map(token => {
      if (token.startsWith('__CODE_BLOCK_')) {
        const index = parseInt(token.replace('__CODE_BLOCK_', '').replace('__', ''));
        return codeBlocks[index].replace(/`|```/g, '').trim();
      }
      if (token.startsWith('__URL_')) {
        const index = parseInt(token.replace('__URL_', '').replace('__', ''));
        return urls[index];
      }
      return token;
    });

    return tokens.join(' ');
  } catch (error) {
    console.error('Error during tokenization:', error);
    return '';
  }
}
