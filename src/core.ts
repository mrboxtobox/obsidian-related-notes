/**
* @file Core functionality for the Related Notes plugin.
* Implements similarity providers and core algorithms for note comparison.
* Includes smart caching to improve performance and reduce token usage.
*/

import { TFile } from 'obsidian';

'use strict';

// const FREQUENCY_CAP = 10; // Currently unused
// const CACHE_VERSION = 1; // Currently unused

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
  getStats(): Record<string, unknown>;
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
 * Validate URL pattern to prevent ReDoS attacks
 * @param url The URL string to validate
 * @returns True if the URL appears to be valid and safe to process
 */
function isValidUrlPattern(url: string): boolean {
  // Check length limits first for early exit
  if (url.length > 2000 || url.length < 4) return false;

  // Count occurrences of potentially dangerous characters
  let plusCount = 0;
  let starCount = 0;
  let dotCount = 0;
  let slashCount = 0;
  let questionCount = 0;
  let hashCount = 0;

  for (let i = 0; i < url.length; i++) {
    const char = url[i];
    switch (char) {
      case '+': if (++plusCount > 10) return false; break;
      case '*': if (++starCount > 10) return false; break;
      case '.': if (++dotCount > 50) return false; break;
      case '/': if (++slashCount > 20) return false; break;
      case '?': if (++questionCount > 10) return false; break;
      case '#': if (++hashCount > 10) return false; break;
    }
  }

  // Basic format validation with safe string operations
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const protocolIndex = url.indexOf('://');
    if (protocolIndex === -1) return false;
    const afterProtocol = url.substring(protocolIndex + 3);
    return afterProtocol.length > 0 && afterProtocol.length < 1500;
  }

  if (url.startsWith('file://')) {
    const afterProtocol = url.substring(7);
    return afterProtocol.length > 0 && afterProtocol.length < 800;
  }

  // For file extensions, use safe indexOf check
  const fileExtensions = ['md', 'txt', 'js', 'ts', 'html', 'css', 'json', 'py', 'java', 'rb', 'c', 'cpp', 'h', 'go', 'rs', 'php'];
  const lowerUrl = url.toLowerCase();
  const hasValidExtension = fileExtensions.some(ext => {
    const expectedSuffix = `.${ext}`;
    return lowerUrl.length >= expectedSuffix.length && 
           lowerUrl.substring(lowerUrl.length - expectedSuffix.length) === expectedSuffix;
  });
  return hasValidExtension && url.length < 500;
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
      const placeholder = `__code_block_${codeBlockCounter}__`;
      codeBlocks.push(match);
      codeBlockCounter++;
      return placeholder;
    });

    // Step 2: Handle URLs and file paths - preserve them
    const urls: string[] = [];
    let urlCounter = 0;
    
    // Safe URL replacement to prevent ReDoS
    processed = processed.replace(/\S+/g, (match) => {
      if (match.length > 500) return match; // Skip very long matches
      
      // Check if this looks like a URL using safe methods
      if (match.startsWith('http://') || match.startsWith('https://') || 
          match.startsWith('file://') || isValidUrlPattern(match)) {
        const placeholder = `__url_${urlCounter}__`;
        urls.push(match);
        urlCounter++;
        return placeholder;
      }
      return match;
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
      if (token.startsWith('__code_block_')) {
        const index = parseInt(token.replace('__code_block_', '').replace('__', ''));
        return codeBlocks[index] ? codeBlocks[index].replace(/`|```/g, '').trim() : token;
      }
      if (token.startsWith('__url_')) {
        const index = parseInt(token.replace('__url_', '').replace('__', ''));
        return urls[index] || token;
      }
      return token;
    });

    return tokens.join(' ');
  } catch (error) {
    console.error('Error during tokenization:', error);
    return '';
  }
}
