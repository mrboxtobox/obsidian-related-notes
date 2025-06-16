/**
 * @file Tests for multi-bloom filter implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  SingleBloomFilter,
  MultiResolutionBloomFilterProvider,
  calculateOptimalBloomSize,
  calculateOptimalHashFunctions
} from './multi-bloom';

describe('Optimal Size Calculations', () => {
  describe('calculateOptimalBloomSize', () => {
    it('should calculate reasonable sizes for different item counts', () => {
      const size1 = calculateOptimalBloomSize(100, 0.01);
      const size2 = calculateOptimalBloomSize(1000, 0.01);
      const size3 = calculateOptimalBloomSize(10000, 0.01);
      
      expect(size1).toBeGreaterThan(0);
      expect(size2).toBeGreaterThan(size1);
      expect(size3).toBeGreaterThan(size2);
      
      // Should be multiples of 32
      expect(size1 % 32).toBe(0);
      expect(size2 % 32).toBe(0);
      expect(size3 % 32).toBe(0);
    });

    it('should handle different false positive rates', () => {
      const highAccuracy = calculateOptimalBloomSize(1000, 0.001); // 0.1%
      const mediumAccuracy = calculateOptimalBloomSize(1000, 0.01);  // 1%
      const lowAccuracy = calculateOptimalBloomSize(1000, 0.1);     // 10%
      
      expect(highAccuracy).toBeGreaterThan(mediumAccuracy);
      expect(mediumAccuracy).toBeGreaterThan(lowAccuracy);
    });

    it('should handle edge cases', () => {
      const smallSize = calculateOptimalBloomSize(1, 0.01);
      const largeSize = calculateOptimalBloomSize(1000000, 0.01);
      
      expect(smallSize).toBeGreaterThan(0);
      expect(largeSize).toBeGreaterThan(smallSize);
    });
  });

  describe('calculateOptimalHashFunctions', () => {
    it('should calculate reasonable hash function counts', () => {
      const hashCount1 = calculateOptimalHashFunctions(1000, 100);
      const hashCount2 = calculateOptimalHashFunctions(2000, 100);
      
      expect(hashCount1).toBeGreaterThanOrEqual(1);
      expect(hashCount2).toBeGreaterThan(hashCount1);
    });

    it('should return at least 1 hash function', () => {
      const hashCount = calculateOptimalHashFunctions(10, 1000);
      expect(hashCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle edge cases', () => {
      const hashCount1 = calculateOptimalHashFunctions(1000, 1);
      const hashCount2 = calculateOptimalHashFunctions(32, 1000);
      
      expect(hashCount1).toBeGreaterThanOrEqual(1);
      expect(hashCount2).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('SingleBloomFilter', () => {
  let filter: SingleBloomFilter;

  beforeEach(() => {
    filter = new SingleBloomFilter([3], [2048], [3]);
  });

  describe('Construction', () => {
    it('should create filter with default settings', () => {
      expect(filter).toBeDefined();
      expect(filter.filter).toBeDefined();
    });

    it('should handle custom settings', () => {
      const customFilter = new SingleBloomFilter([4], [4096], [4]);
      expect(customFilter).toBeDefined();
    });
  });

  describe('Text Processing', () => {
    it('should add text and detect similarity', () => {
      const text1 = 'artificial intelligence machine learning deep learning';
      const text2 = 'machine learning algorithms artificial intelligence';
      
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(text1);
      filter2.addText(text2);
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('should handle empty text', () => {
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText('');
      filter2.addText('');
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeDefined();
    });

    it('should handle very large documents', () => {
      const largeText = 'word '.repeat(5000);
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(largeText);
      filter2.addText(largeText);
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should respect character limits', () => {
      const veryLargeText = 'word '.repeat(20000); // Large text
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(veryLargeText);
      
      // Should still work
      expect(filter1.getStats()).toBeDefined();
    });
  });

  describe('CJK Text Handling', () => {
    it('should handle Chinese text properly', () => {
      const chineseText1 = '人工智能机器学习深度学习神经网络';
      const chineseText2 = '机器学习人工智能算法神经网络';
      
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(chineseText1);
      filter2.addText(chineseText2);
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeGreaterThan(0);
    });

    it('should handle Japanese text', () => {
      const japaneseText = 'これは日本語のテストです。機械学習について説明します。';
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(japaneseText);
      filter2.addText(japaneseText);
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeGreaterThan(0.5);
    });

    it('should handle mixed language content', () => {
      const mixedText = 'Hello 世界 machine learning 机器学习 test テスト';
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText(mixedText);
      filter2.addText(mixedText);
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeGreaterThan(0.5);
    });
  });

  describe('N-gram Processing', () => {
    it('should generate different n-grams based on text type', () => {
      const englishText = 'artificial intelligence';
      const chineseText = '人工智能';
      
      const enFilter1 = new SingleBloomFilter([3], [2048], [3]);
      const enFilter2 = new SingleBloomFilter([3], [2048], [3]);
      const zhFilter1 = new SingleBloomFilter([3], [2048], [3]);
      const zhFilter2 = new SingleBloomFilter([3], [2048], [3]);
      
      enFilter1.addText(englishText);
      enFilter2.addText(englishText);
      zhFilter1.addText(chineseText);
      zhFilter2.addText(chineseText);
      
      // Both should be processed successfully
      const enSimilarity = enFilter1.similarity(enFilter2);
      const zhSimilarity = zhFilter1.similarity(zhFilter2);
      
      expect(enSimilarity).toBeGreaterThan(0.5);
      expect(zhSimilarity).toBeGreaterThan(0.5);
    });

    it('should handle edge cases in n-gram generation', () => {
      const shortText = 'AI';
      const singleChar = 'A';
      
      const shortFilter = new SingleBloomFilter([3], [2048], [3]);
      const singleFilter = new SingleBloomFilter([3], [2048], [3]);
      
      shortFilter.addText(shortText);
      singleFilter.addText(singleChar);
      
      expect(shortFilter.getStats()).toBeDefined();
      expect(singleFilter.getStats()).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid text gracefully', () => {
      expect(() => filter.addText('')).not.toThrow();
      expect(() => filter.addText('test')).not.toThrow();
    });

    it('should handle similarity computation safely', () => {
      const filter1 = new SingleBloomFilter([3], [2048], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText('test');
      filter2.addText('different');
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeDefined();
      expect(similarity).toBeGreaterThanOrEqual(0);
      expect(similarity).toBeLessThanOrEqual(1);
    });

    it('should handle size mismatches gracefully', () => {
      const filter1 = new SingleBloomFilter([3], [1024], [3]);
      const filter2 = new SingleBloomFilter([3], [2048], [3]);
      
      filter1.addText('test');
      filter2.addText('test');
      
      const similarity = filter1.similarity(filter2);
      expect(similarity).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should handle many text additions efficiently', () => {
      const startTime = Date.now();
      
      for (let i = 0; i < 100; i++) {
        filter.addText(`Document ${i} content with unique terms ${i}`);
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds
    });

    it('should compute similarities efficiently', () => {
      const filters: SingleBloomFilter[] = [];
      
      // Create multiple filters with different content
      for (let i = 0; i < 10; i++) {
        const testFilter = new SingleBloomFilter([3], [2048], [3]);
        testFilter.addText(`Document ${i} with some shared content`);
        filters.push(testFilter);
      }
      
      const startTime = Date.now();
      
      // Compute many similarities
      for (let i = 0; i < filters.length; i++) {
        for (let j = i + 1; j < filters.length; j++) {
          filters[i].similarity(filters[j]);
        }
      }
      
      const endTime = Date.now();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});

describe('MultiResolutionBloomFilterProvider', () => {
  let provider: MultiResolutionBloomFilterProvider;

  beforeEach(() => {
    const mockVault = {
      getMarkdownFiles: () => [],
      adapter: {
        exists: () => Promise.resolve(false),
        read: () => Promise.resolve(''),
        write: () => Promise.resolve(),
        mkdir: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      configDir: '/mock/config'
    } as any;

    provider = new MultiResolutionBloomFilterProvider(mockVault, {
      ngramSizes: [3],
      bloomSizes: [2048],
      hashFunctions: [3],
      similarityThreshold: 0.1
    });
  });

  describe('Initialization', () => {
    it('should initialize without errors', async () => {
      await expect(provider.initialize()).resolves.not.toThrow();
    });

    it('should handle progress callbacks', async () => {
      let progressCalled = false;
      const progressCallback = (processed: number, total: number) => {
        progressCalled = true;
        expect(processed).toBeGreaterThanOrEqual(0);
        expect(total).toBeGreaterThanOrEqual(0);
      };
      
      await provider.initialize(progressCallback);
      // Progress callback might not be called if no files to process
    });
  });

  describe('File Operations', () => {
    it('should track indexed files', async () => {
      const mockFile = { path: 'test.md' } as any;
      
      expect(provider.isFileIndexed(mockFile)).toBe(false);
      
      await provider.processDocument('test.md', 'test content');
      
      expect(provider.isFileIndexed(mockFile)).toBe(true);
    });

    it('should get candidate files', () => {
      const mockFile = { path: 'test.md' } as any;
      const candidates = provider.getCandidateFiles(mockFile);
      
      expect(Array.isArray(candidates)).toBe(true);
    });
  });

  describe('Stats', () => {
    it('should provide comprehensive stats', () => {
      const stats = provider.getStats();
      
      expect(stats).toBeDefined();
      expect(typeof stats.documentsProcessed).toBe('number');
      expect(Array.isArray(stats.ngramSizes)).toBe(true);
      expect(Array.isArray(stats.bloomSizes)).toBe(true);
      expect(Array.isArray(stats.hashFunctions)).toBe(true);
      expect(typeof stats.similarityThreshold).toBe('number');
      expect(typeof stats.memoryUsage).toBe('object');
      expect(typeof stats.memoryUsage.totalBytes).toBe('number');
    });

    it('should update stats after processing documents', async () => {
      const initialStats = provider.getStats();
      
      await provider.processDocument('test', 'test content');
      
      const updatedStats = provider.getStats();
      expect(updatedStats.documentsProcessed).toBeGreaterThan(initialStats.documentsProcessed);
    });
  });
});