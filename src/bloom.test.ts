/**
 * @file Tests for bloom filter implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BloomFilter, BloomFilterSimilarityProvider } from './bloom';

describe('BloomFilter', () => {
  let bloomFilter: BloomFilter;

  beforeEach(() => {
    bloomFilter = new BloomFilter(256, 3);
  });

  describe('Constructor', () => {
    it('should create a bloom filter with correct size', () => {
      expect(bloomFilter.getSize()).toBe(256);
      expect(bloomFilter.getHashFunctions()).toBe(3);
    });

    it('should handle non-32-bit-aligned sizes', () => {
      const filter = new BloomFilter(100, 2);
      expect(filter.getSize()).toBe(128); // Rounded up to nearest 32-bit boundary
    });

    it('should calculate memory usage correctly', () => {
      expect(bloomFilter.getMemoryUsage()).toBe(32); // 256 bits = 32 bytes
    });
  });

  describe('Add and Contains', () => {
    it('should add items and detect them', () => {
      bloomFilter.add('test');
      expect(bloomFilter.contains('test')).toBe(true);
    });

    it('should handle empty strings', () => {
      bloomFilter.add('');
      expect(bloomFilter.contains('')).toBe(true);
    });

    it('should handle unicode characters', () => {
      const unicodeText = '测试文本';
      bloomFilter.add(unicodeText);
      expect(bloomFilter.contains(unicodeText)).toBe(true);
    });

    it('should handle special characters', () => {
      const specialText = '!@#$%^&*()_+-=[]{}|;:,.<>?';
      bloomFilter.add(specialText);
      expect(bloomFilter.contains(specialText)).toBe(true);
    });

    it('should not have false negatives', () => {
      const items = ['apple', 'banana', 'cherry', 'date', 'elderberry'];
      items.forEach(item => bloomFilter.add(item));
      items.forEach(item => {
        expect(bloomFilter.contains(item)).toBe(true);
      });
    });
  });

  describe('False Positive Rate', () => {
    it('should calculate false positive rate', () => {
      const rate = bloomFilter.getFalsePositiveRate();
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(1);
    });

    it('should increase false positive rate as items are added', () => {
      const initialRate = bloomFilter.getFalsePositiveRate();
      
      // Add many items
      for (let i = 0; i < 100; i++) {
        bloomFilter.add(`item${i}`);
      }
      
      const finalRate = bloomFilter.getFalsePositiveRate();
      expect(finalRate).toBeGreaterThan(initialRate);
    });
  });

  describe('Serialization', () => {
    it('should serialize and deserialize correctly', () => {
      bloomFilter.add('test1');
      bloomFilter.add('test2');
      
      const serialized = bloomFilter.serialize();
      expect(serialized).toBeDefined();
      
      const newFilter = new BloomFilter(256, 3);
      newFilter.deserialize(serialized);
      
      expect(newFilter.contains('test1')).toBe(true);
      expect(newFilter.contains('test2')).toBe(true);
    });

    it('should handle empty filter serialization', () => {
      const serialized = bloomFilter.serialize();
      const newFilter = new BloomFilter(256, 3);
      newFilter.deserialize(serialized);
      
      expect(newFilter.getSize()).toBe(256);
      expect(newFilter.getHashFunctions()).toBe(3);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very long strings', () => {
      const longString = 'x'.repeat(10000);
      bloomFilter.add(longString);
      expect(bloomFilter.contains(longString)).toBe(true);
    });

    it('should handle numerical strings', () => {
      const numbers = ['123', '456.789', '-123', '1e10'];
      numbers.forEach(num => bloomFilter.add(num));
      numbers.forEach(num => {
        expect(bloomFilter.contains(num)).toBe(true);
      });
    });

    it('should handle similar strings differently', () => {
      bloomFilter.add('test');
      bloomFilter.add('Test');
      bloomFilter.add('TEST');
      
      expect(bloomFilter.contains('test')).toBe(true);
      expect(bloomFilter.contains('Test')).toBe(true);
      expect(bloomFilter.contains('TEST')).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should handle large number of additions efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        bloomFilter.add(`item${i}`);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle large number of lookups efficiently', () => {
      // Add items first
      for (let i = 0; i < 100; i++) {
        bloomFilter.add(`item${i}`);
      }
      
      const startTime = Date.now();
      
      for (let i = 0; i < 1000; i++) {
        bloomFilter.contains(`item${i % 100}`);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});

describe('BloomFilterSimilarityProvider', () => {
  let provider: BloomFilterSimilarityProvider;

  beforeEach(() => {
    provider = new BloomFilterSimilarityProvider(3, 256, 3, {});
  });

  describe('Document Processing', () => {
    it('should process documents correctly', () => {
      provider.processDocument('doc1', 'This is a test document with some content');
      expect(provider.size()).toBe(1);
      expect(provider.getStats().documentsIndexed).toBe(1);
    });

    it('should handle empty documents', () => {
      provider.processDocument('empty', '');
      expect(provider.size()).toBe(1);
      expect(provider.getStats().documentsIndexed).toBe(1);
    });

    it('should handle unicode content', () => {
      provider.processDocument('unicode', '这是一个测试文档，包含中文内容');
      expect(provider.size()).toBe(1);
      expect(provider.getStats().documentsIndexed).toBe(1);
    });

    it('should handle very large documents', () => {
      const largeContent = 'word '.repeat(5000);
      provider.processDocument('large', largeContent);
      expect(provider.size()).toBe(1);
      expect(provider.getStats().documentsIndexed).toBe(1);
    });
  });

  describe('Similarity Computation', () => {
    it('should compute similarity between similar documents', () => {
      const content1 = 'artificial intelligence machine learning deep learning neural networks';
      const content2 = 'machine learning artificial intelligence neural networks algorithms';
      
      provider.processDocument('doc1', content1);
      provider.processDocument('doc2', content2);
      
      const similarity = provider.calculateSimilarity('doc1', 'doc2');
      
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('should return low similarity for dissimilar documents', () => {
      const content1 = 'cooking recipes food ingredients kitchen';
      const content2 = 'programming software development code algorithms';
      
      provider.processDocument('cooking', content1);
      provider.processDocument('programming', content2);
      
      const similarity = provider.calculateSimilarity('cooking', 'programming');
      
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThan(0.5);
    });

    it('should handle identical documents', () => {
      const content = 'identical content for testing similarity';
      
      provider.processDocument('doc1', content);
      provider.processDocument('doc2', content);
      
      const similarity = provider.calculateSimilarity('doc1', 'doc2');
      
      expect(similarity).toBeGreaterThan(0.8);
    });
  });

  describe('Stats', () => {
    it('should provide meaningful stats', () => {
      const stats = provider.getStats();
      expect(stats).toBeDefined();
      expect(typeof stats.documentsIndexed).toBe('number');
      expect(typeof stats.ngramSize).toBe('number');
      expect(typeof stats.bloomFilterSize).toBe('number');
      expect(typeof stats.hashFunctions).toBe('number');
    });
  });
});