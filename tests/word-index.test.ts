/**
 * @file Tests for word-based candidate selector
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WordBasedCandidateSelector } from '../src/word-index';

describe('WordBasedCandidateSelector', () => {
  let selector: WordBasedCandidateSelector;

  beforeEach(() => {
    selector = new WordBasedCandidateSelector();
  });

  describe('Basic Operations', () => {
    it('should initialize empty', () => {
      const stats = selector.getStats();
      expect(stats.totalDocuments).toBe(0);
      expect(stats.totalUniqueWords).toBe(0);
    });

    it('should add documents and track words', () => {
      selector.addDocument('doc1', 'artificial intelligence machine learning');
      selector.addDocument('doc2', 'deep learning neural networks');
      
      const stats = selector.getStats();
      expect(stats.totalDocuments).toBe(2);
      expect(stats.totalUniqueWords).toBeGreaterThan(0);
    });

    it('should check if document is indexed', () => {
      expect(selector.isDocumentIndexed('doc1')).toBe(false);
      
      selector.addDocument('doc1', 'test content');
      expect(selector.isDocumentIndexed('doc1')).toBe(true);
    });

    it('should remove documents', () => {
      selector.addDocument('doc1', 'test content here');
      expect(selector.isDocumentIndexed('doc1')).toBe(true);
      
      selector.removeDocument('doc1');
      expect(selector.isDocumentIndexed('doc1')).toBe(false);
      
      const stats = selector.getStats();
      expect(stats.totalDocuments).toBe(0);
    });
  });

  describe('Fast Candidate Selection', () => {
    beforeEach(() => {
      // Set up test documents with overlapping content
      selector.addDocument('doc1', 'artificial intelligence machine learning deep learning algorithms');
      selector.addDocument('doc2', 'machine learning neural networks deep learning models');
      selector.addDocument('doc3', 'natural language processing text analysis algorithms');
      selector.addDocument('doc4', 'computer vision image processing deep learning');
      selector.addDocument('doc5', 'database systems data management algorithms');
      selector.addDocument('doc6', 'web development frontend backend programming');
    });

    it('should find candidates using random word sampling', () => {
      const candidates = selector.getFastCandidates('doc1', 5, 3);
      
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeLessThanOrEqual(5);
      
      // Should not include the query document itself
      expect(candidates).not.toContain('doc1');
      
      // All candidates should be valid document IDs
      candidates.forEach(candidate => {
        expect(typeof candidate).toBe('string');
        expect(selector.isDocumentIndexed(candidate)).toBe(true);
      });
    });

    it('should return empty array for non-existent document', () => {
      const candidates = selector.getFastCandidates('nonexistent', 5, 3);
      expect(candidates).toEqual([]);
    });

    it('should respect maxCandidates limit', () => {
      const candidates = selector.getFastCandidates('doc1', 2, 3);
      expect(candidates.length).toBeLessThanOrEqual(2);
    });

    it('should find relevant candidates based on shared words', () => {
      // Doc1 has "machine learning deep learning algorithms"
      // Doc2 has "machine learning neural networks deep learning"
      // They share "machine", "learning", "deep"
      const candidates = selector.getFastCandidates('doc1', 10, 4);
      
      // Should find doc2 as it shares multiple words
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('should handle different sample word counts', () => {
      const candidates1 = selector.getFastCandidates('doc1', 10, 1);
      const candidates2 = selector.getFastCandidates('doc1', 10, 5);
      
      expect(Array.isArray(candidates1)).toBe(true);
      expect(Array.isArray(candidates2)).toBe(true);
    });
  });

  describe('Word-Specific Candidate Selection', () => {
    beforeEach(() => {
      selector.addDocument('doc1', 'machine learning artificial intelligence');
      selector.addDocument('doc2', 'deep learning neural networks');
      selector.addDocument('doc3', 'natural language processing');
      selector.addDocument('doc4', 'machine learning models training');
      selector.addDocument('doc5', 'computer vision algorithms');
    });

    it('should find candidates containing specific words', () => {
      const candidates = selector.getCandidatesForWords('doc1', ['machine', 'learning'], 10);
      
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates).not.toContain('doc1'); // Should exclude query doc
      
      // Should find doc4 which contains both "machine" and "learning"
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('should respect maxCandidates in word-specific search', () => {
      const candidates = selector.getCandidatesForWords('doc1', ['learning'], 2);
      expect(candidates.length).toBeLessThanOrEqual(2);
    });

    it('should handle empty word list', () => {
      const candidates = selector.getCandidatesForWords('doc1', [], 10);
      expect(candidates).toEqual([]);
    });

    it('should handle non-existent words', () => {
      const candidates = selector.getCandidatesForWords('doc1', ['nonexistentword'], 10);
      expect(candidates).toEqual([]);
    });
  });

  describe('Word Statistics', () => {
    beforeEach(() => {
      selector.addDocument('doc1', 'machine learning algorithm');
      selector.addDocument('doc2', 'machine learning neural network');
      selector.addDocument('doc3', 'deep learning algorithm');
      selector.addDocument('doc4', 'natural language processing');
    });

    it('should get most common words', () => {
      const commonWords = selector.getMostCommonWords(5);
      
      expect(Array.isArray(commonWords)).toBe(true);
      expect(commonWords.length).toBeLessThanOrEqual(5);
      
      // Each entry should be [word, count]
      commonWords.forEach(([word, count]) => {
        expect(typeof word).toBe('string');
        expect(typeof count).toBe('number');
        expect(count).toBeGreaterThan(0);
      });
      
      // Should be sorted by frequency (descending)
      for (let i = 1; i < commonWords.length; i++) {
        expect(commonWords[i][1]).toBeLessThanOrEqual(commonWords[i-1][1]);
      }
    });

    it('should get documents containing specific word', () => {
      // The tokenizer stems "learning" to "learn", so search for the stemmed version
      const docs = selector.getDocumentsContainingWord('learn');
      
      expect(Array.isArray(docs)).toBe(true);
      expect(docs.length).toBeGreaterThan(0);
      
      // Should contain docs that have "learning" (indexed as "learn")
      expect(docs).toContain('doc1');
      expect(docs).toContain('doc2');
      expect(docs).toContain('doc3');
    });

    it('should handle case insensitive word search', () => {
      const docs1 = selector.getDocumentsContainingWord('LEARN');
      const docs2 = selector.getDocumentsContainingWord('learn');
      
      expect(docs1).toEqual(docs2);
    });

    it('should return empty array for non-existent word', () => {
      const docs = selector.getDocumentsContainingWord('nonexistentword');
      expect(docs).toEqual([]);
    });
  });

  describe('Text Processing', () => {
    it('should handle empty text', () => {
      expect(() => selector.addDocument('empty', '')).not.toThrow();
      expect(selector.isDocumentIndexed('empty')).toBe(true);
    });

    it('should handle special characters', () => {
      const text = 'Hello! @#$%^&*() World? Testing... 123';
      expect(() => selector.addDocument('special', text)).not.toThrow();
    });

    it('should handle very long text', () => {
      const longText = 'word '.repeat(10000);
      expect(() => selector.addDocument('long', longText)).not.toThrow();
    });

    it('should handle CJK text', () => {
      const chineseText = '人工智能机器学习深度学习';
      const japaneseText = 'これは日本語のテストです';
      
      expect(() => {
        selector.addDocument('chinese', chineseText);
        selector.addDocument('japanese', japaneseText);
      }).not.toThrow();
      
      expect(selector.isDocumentIndexed('chinese')).toBe(true);
      expect(selector.isDocumentIndexed('japanese')).toBe(true);
    });

    it('should filter out very short words', () => {
      selector.addDocument('short', 'a an to be is the of for in');
      
      const stats = selector.getStats();
      // Should have filtered out most short words
      expect(stats.totalUniqueWords).toBe(0); // All words are too short
    });

    it('should filter out very long words', () => {
      const veryLongWord = 'a'.repeat(30);
      selector.addDocument('long', `normal word ${veryLongWord} another`);
      
      const commonWords = selector.getMostCommonWords(10);
      const wordList = commonWords.map(([word]) => word);
      
      // Should not contain the very long word
      expect(wordList).not.toContain(veryLongWord);
    });
  });

  describe('Memory Management', () => {
    it('should clear all data', () => {
      selector.addDocument('doc1', 'test content');
      selector.addDocument('doc2', 'more content');
      
      let stats = selector.getStats();
      expect(stats.totalDocuments).toBe(2);
      
      selector.clear();
      
      stats = selector.getStats();
      expect(stats.totalDocuments).toBe(0);
      expect(stats.totalUniqueWords).toBe(0);
    });

    it('should handle rapid additions and removals', () => {
      // Add many documents
      for (let i = 0; i < 100; i++) {
        selector.addDocument(`doc${i}`, `document ${i} content with words`);
      }
      
      let stats = selector.getStats();
      expect(stats.totalDocuments).toBe(100);
      
      // Remove half
      for (let i = 0; i < 50; i++) {
        selector.removeDocument(`doc${i}`);
      }
      
      stats = selector.getStats();
      expect(stats.totalDocuments).toBe(50);
    });
  });

  describe('Performance', () => {
    it('should handle large number of documents efficiently', () => {
      const startTime = Date.now();
      
      // Add 1000 documents
      for (let i = 0; i < 1000; i++) {
        const content = `document ${i} about topic ${i % 10} with content and data`;
        selector.addDocument(`doc${i}`, content);
      }
      
      const addTime = Date.now() - startTime;
      expect(addTime).toBeLessThan(10000); // Should complete within 10 seconds
      
      // Test candidate selection performance
      const searchStart = Date.now();
      const candidates = selector.getFastCandidates('doc0', 50, 4);
      const searchTime = Date.now() - searchStart;
      
      expect(searchTime).toBeLessThan(1000); // Should complete within 1 second
      expect(candidates.length).toBeLessThanOrEqual(50);
    }, 15000); // 15 second timeout for this test

    it('should perform fast word-based searches', () => {
      // Add documents with overlapping vocabulary
      for (let i = 0; i < 100; i++) {
        const topics = ['machine', 'learning', 'algorithm', 'data', 'neural', 'network'];
        const selectedTopics = topics.slice(0, 3 + (i % 3));
        selector.addDocument(`doc${i}`, selectedTopics.join(' ') + ` document ${i}`);
      }
      
      const startTime = Date.now();
      
      // Perform many searches
      for (let i = 0; i < 10; i++) {
        selector.getFastCandidates(`doc${i}`, 20, 3);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });

  describe('Edge Cases', () => {
    it('should handle document updates (remove then add)', () => {
      selector.addDocument('doc1', 'original content');
      expect(selector.isDocumentIndexed('doc1')).toBe(true);
      
      // Update by removing and adding again
      selector.removeDocument('doc1');
      selector.addDocument('doc1', 'updated content');
      
      expect(selector.isDocumentIndexed('doc1')).toBe(true);
      
      const stats = selector.getStats();
      expect(stats.totalDocuments).toBe(1);
    });

    it('should handle removing non-existent document', () => {
      expect(() => selector.removeDocument('nonexistent')).not.toThrow();
      
      const stats = selector.getStats();
      expect(stats.totalDocuments).toBe(0);
    });

    it('should handle multiple documents with identical content', () => {
      const content = 'identical content for testing';
      
      selector.addDocument('doc1', content);
      selector.addDocument('doc2', content);
      selector.addDocument('doc3', content);
      
      const candidates = selector.getFastCandidates('doc1', 10, 2);
      
      // Should find the other documents with identical content
      expect(candidates.length).toBeGreaterThan(0);
      
      // Since we're using random sampling, we might not get all documents
      // but we should get at least one of the other documents
      const hasDoc2 = candidates.includes('doc2');
      const hasDoc3 = candidates.includes('doc3');
      expect(hasDoc2 || hasDoc3).toBe(true);
      
      // All returned candidates should be valid
      candidates.forEach(candidate => {
        expect(['doc2', 'doc3']).toContain(candidate);
      });
    });

    it('should handle documents with no meaningful words', () => {
      selector.addDocument('punctuation', '!@#$%^&*()_+-=[]{}|;:,.<>?');
      selector.addDocument('numbers', '1 2 3 4 5 6 7 8 9 0');
      selector.addDocument('short', 'a an to be is at of in on');
      
      const stats = selector.getStats();
      // Should still track documents even if no words are indexed
      expect(stats.totalDocuments).toBe(3);
    });
  });
});