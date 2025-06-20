/**
 * @file Tests for multi-bloom filter implementation
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { 
  SingleBloomFilter,
  MultiResolutionBloomFilterProvider,
  calculateOptimalBloomSize,
  calculateOptimalHashFunctions
} from '../src/multi-bloom';
import { WordBasedCandidateSelector } from '../src/word-index';

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
      similarityThreshold: 0.1,
      useWordBasedCandidates: true // Enable word-based candidate selection
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

    it('should handle graceful cancellation during initialization', async () => {
      // Create a mock vault with many files to simulate longer initialization
      const mockFiles = Array.from({ length: 100 }, (_, i) => ({
        path: `test_${i}.md`,
        stat: { mtime: Date.now() },
        cachedRead: () => Promise.resolve(`Content for file ${i}`)
      }));
      
      const mockVault = {
        getMarkdownFiles: () => mockFiles,
        cachedRead: (file: any) => Promise.resolve(`Content for ${file.path}`)
      };
      
      const testProvider = new MultiResolutionBloomFilterProvider(mockVault, {
        ngramSizes: [3, 4],
        bloomSizes: [1024, 2048],
        hashFunctions: [3, 4],
        similarityThreshold: 0.15
      });
      
      // Start initialization
      const initPromise = testProvider.initialize();
      
      // Cancel immediately
      (testProvider as any).stopRequested = true;
      
      // Should not throw an error
      await expect(initPromise).resolves.not.toThrow();
      
      // Should not be marked as initialized
      expect((testProvider as any).isInitialized).toBe(false);
    });
    
    it('should not reindex when valid cache exists', async () => {
      // Create a mock vault with cache that will be considered valid
      const mockVault = {
        getMarkdownFiles: () => [],
        adapter: {
          exists: (path: string) => Promise.resolve(path.includes('.bloom-filter-cache.json')),
          read: (path: string) => Promise.resolve(JSON.stringify({
            version: 1, // Current cache version
            timestamp: Date.now(), // Fresh timestamp
            params: {
              ngramSizes: [3],
              bloomSizes: [2048],
              hashFunctions: [3],
              similarityThreshold: 0.1
            },
            stats: {
              documentCount: 0,
              commonWordsComputed: false,
              commonWordsCount: 0,
              totalDocuments: 0
            },
            filters: {}, // Empty but valid structure
            commonWords: []
          })),
          write: () => Promise.resolve(),
          mkdir: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
        configDir: '/mock/config'
      } as any;
      
      // Create a spy to track if documents are processed
      let documentsProcessed = 0;
      const originalProcessDocument = MultiResolutionBloomFilterProvider.prototype.processDocument;
      
      // Mock processDocument to track calls
      MultiResolutionBloomFilterProvider.prototype.processDocument = async function(docId: string, content: string) {
        documentsProcessed++;
        return await originalProcessDocument.call(this, docId, content);
      };
      
      try {
        const testProvider = new MultiResolutionBloomFilterProvider(mockVault, {
          ngramSizes: [3],
          bloomSizes: [2048],
          hashFunctions: [3],
          similarityThreshold: 0.1
        });
        
        // Initialize should load from cache without reindexing
        await testProvider.initialize();
        
        // Verify no documents were processed (no reindexing)
        expect(documentsProcessed).toBe(0);
        
        // Verify it's considered initialized
        expect((testProvider as any).isInitialized).toBe(true);
      } finally {
        // Restore original method
        MultiResolutionBloomFilterProvider.prototype.processDocument = originalProcessDocument;
      }
    });

    it('should simulate restart scenario and not reindex when cache exists', async () => {
      // Simulate a vault with some files and a saved cache
      const mockFiles = [
        { path: 'note1.md', basename: 'note1' },
        { path: 'note2.md', basename: 'note2' },
        { path: 'note3.md', basename: 'note3' }
      ];

      // Simulate cache with actual document data
      const savedCache = {
        version: 1,
        timestamp: Date.now(),
        params: {
          ngramSizes: [3],
          bloomSizes: [2048],
          hashFunctions: [3],
          similarityThreshold: 0.1
        },
        stats: {
          documentCount: 3,
          commonWordsComputed: true,
          commonWordsCount: 5,
          totalDocuments: 3
        },
        filters: {
          'note1.md': {
            ngramSizes: [3],
            'bloom_3': new Array(64).fill(0) // 2048 bits / 32 = 64 elements
          },
          'note2.md': {
            ngramSizes: [3],
            'bloom_3': new Array(64).fill(0)
          },
          'note3.md': {
            ngramSizes: [3],
            'bloom_3': new Array(64).fill(0)
          }
        },
        commonWords: ['the', 'and', 'to', 'of', 'a']
      };

      const mockVault = {
        getMarkdownFiles: () => mockFiles,
        cachedRead: (file: any) => Promise.resolve(`Content of ${file.path}`),
        adapter: {
          exists: (path: string) => Promise.resolve(path.includes('.bloom-filter-cache.json')),
          read: (path: string) => Promise.resolve(JSON.stringify(savedCache)),
          write: () => Promise.resolve(),
          mkdir: () => Promise.resolve(),
          remove: () => Promise.resolve(),
        },
        configDir: '/mock/config'
      } as any;

      // Track if any documents are freshly processed
      let freshIndexingCount = 0;
      let cacheRepopulationCount = 0;
      
      const originalProcessDocument = MultiResolutionBloomFilterProvider.prototype.processDocument;
      MultiResolutionBloomFilterProvider.prototype.processDocument = async function(docId: string, content: string) {
        freshIndexingCount++;
        return await originalProcessDocument.call(this, docId, content);
      };

      // Track word candidate selector calls to distinguish cache repopulation from fresh indexing
      const originalAddDocument = WordBasedCandidateSelector.prototype.addDocument;
      WordBasedCandidateSelector.prototype.addDocument = function(docPath: string, text: string) {
        cacheRepopulationCount++;
        return originalAddDocument.call(this, docPath, text);
      };

      try {
        // First session: create provider and initialize
        const provider1 = new MultiResolutionBloomFilterProvider(mockVault, {
          ngramSizes: [3],
          bloomSizes: [2048],
          hashFunctions: [3],
          similarityThreshold: 0.1,
          useWordBasedCandidates: true
        });

        await provider1.initialize();

        // Should load from cache, so no fresh indexing
        expect(freshIndexingCount).toBe(0);
        expect((provider1 as any).isInitialized).toBe(true);
        expect((provider1 as any).bloomFilters.size).toBe(3);

        // Word candidate selector should be repopulated from cache (this is expected)
        expect(cacheRepopulationCount).toBe(3); // One call per cached document

        // Reset counters for restart simulation
        freshIndexingCount = 0;
        cacheRepopulationCount = 0;

        // Second session: simulate Obsidian restart - create new provider instance
        const provider2 = new MultiResolutionBloomFilterProvider(mockVault, {
          ngramSizes: [3],
          bloomSizes: [2048],
          hashFunctions: [3],
          similarityThreshold: 0.1,
          useWordBasedCandidates: true
        });

        await provider2.initialize();

        // Should still load from cache on restart, no fresh indexing
        expect(freshIndexingCount).toBe(0);
        expect((provider2 as any).isInitialized).toBe(true);
        expect((provider2 as any).bloomFilters.size).toBe(3);

        // Word candidate selector repopulated again (expected on restart)
        expect(cacheRepopulationCount).toBe(3);

        // Verify provider loaded the documents from cache (not freshly processed)
        const stats = provider2.getStats();
        expect(stats.documentsProcessed).toBe(0); // Should be 0 because documents were loaded from cache, not processed
        
      } finally {
        // Restore original methods
        MultiResolutionBloomFilterProvider.prototype.processDocument = originalProcessDocument;
        WordBasedCandidateSelector.prototype.addDocument = originalAddDocument;
      }
    });
  });

  describe('File Operations', () => {
    it('should track indexed files', async () => {
      const mockFile = { path: 'test.md' } as any;
      
      expect(provider.isFileIndexed(mockFile)).toBe(false);
      
      await provider.processDocument('test.md', 'test content');
      
      expect(provider.isFileIndexed(mockFile)).toBe(true);
    });

    it('should get candidate files', async () => {
      const mockFile = { path: 'test.md' } as any;
      const candidates = await provider.getCandidateFiles(mockFile);
      
      expect(Array.isArray(candidates)).toBe(true);
    });
  });

  describe('Smart Candidate Selection', () => {
    it('should select candidates for similarity comparison', async () => {
      // Create a provider with several documents
      for (let i = 0; i < 20; i++) {
        const category = i % 3 === 0 ? 'science' : i % 3 === 1 ? 'history' : 'fiction';
        const content = `This is a ${category} document about ${category} topics with ${category} content and research.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }

      // Add a query document 
      await provider.processDocument('query_doc', 'This is a test document about research topics with content.');

      // Test smart candidate selection
      const smartCandidates = await provider.getSmartCandidates('query_doc', 10);
      
      expect(smartCandidates.length).toBeLessThanOrEqual(10);
      expect(smartCandidates.length).toBeGreaterThan(0);
      
      // All candidates should be valid document IDs
      smartCandidates.forEach(candidate => {
        expect(typeof candidate).toBe('string');
        expect(candidate.length).toBeGreaterThan(0);
      });
    }, 10000); // 10 second timeout

    it('should handle empty result gracefully', async () => {
      const candidates = await provider.getSmartCandidates('nonexistent', 10);
      expect(candidates).toEqual([]);
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

    it('should include word index stats when enabled', () => {
      const stats = provider.getStats();
      
      // Should include word index stats since useWordBasedCandidates is true
      expect(stats.wordIndex).toBeDefined();
      expect(typeof stats.wordIndex.totalDocuments).toBe('number');
      expect(typeof stats.wordIndex.totalUniqueWords).toBe('number');
    });

    it('should update stats after processing documents', async () => {
      const initialStats = provider.getStats();
      
      await provider.processDocument('test', 'test content');
      
      const updatedStats = provider.getStats();
      expect(updatedStats.documentsProcessed).toBeGreaterThan(initialStats.documentsProcessed);
      
      // Word index stats should also be updated
      if (updatedStats.wordIndex) {
        expect(updatedStats.wordIndex.totalDocuments).toBeGreaterThan(0);
      }
    });
  });

  describe('Word-Based Candidate Selection Integration', () => {
    beforeEach(async () => {
      // Add documents to test word-based candidate selection
      await provider.processDocument('ai_doc', 'artificial intelligence machine learning deep learning algorithms');
      await provider.processDocument('ml_doc', 'machine learning neural networks training models');
      await provider.processDocument('nlp_doc', 'natural language processing text analysis algorithms');
      await provider.processDocument('cv_doc', 'computer vision image processing deep learning');
      await provider.processDocument('db_doc', 'database systems data management storage');
    });

    it('should use word-based candidates when enabled', async () => {
      const startTime = Date.now();
      const candidates = await provider.getSmartCandidates('ai_doc', 10);
      const endTime = Date.now();
      
      expect(Array.isArray(candidates)).toBe(true);
      expect(candidates.length).toBeLessThanOrEqual(10);
      expect(candidates).not.toContain('ai_doc'); // Should not include query doc
      
      // Should be fast (word-based selection)
      expect(endTime - startTime).toBeLessThan(100); // Less than 100ms
      
      // Should find relevant documents
      expect(candidates.length).toBeGreaterThan(0);
    });

    it('should find semantically related candidates', async () => {
      const candidates = await provider.getSmartCandidates('ai_doc', 5);
      
      // ai_doc contains "machine learning deep learning algorithms"
      // Should find ml_doc (has "machine learning") and cv_doc (has "deep learning")
      expect(candidates.length).toBeGreaterThan(0);
      
      // Verify candidates are valid
      candidates.forEach(candidate => {
        expect(typeof candidate).toBe('string');
        expect(candidate.length).toBeGreaterThan(0);
        expect(provider.isFileIndexed({ path: candidate } as any)).toBe(true);
      });
    });

    it('should handle fallback to bloom filter selection', async () => {
      // Create provider without word-based candidates
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

      const fallbackProvider = new MultiResolutionBloomFilterProvider(mockVault, {
        ngramSizes: [3],
        bloomSizes: [2048],
        hashFunctions: [3],
        similarityThreshold: 0.1,
        useWordBasedCandidates: false // Disable word-based candidates
      });

      await fallbackProvider.processDocument('test', 'test content');
      const candidates = await fallbackProvider.getSmartCandidates('test', 5);
      
      // Should still work with bloom filter fallback
      expect(Array.isArray(candidates)).toBe(true);
    });

    it('should perform well with many documents', async () => {
      // Add more documents for performance testing
      for (let i = 0; i < 50; i++) {
        const topics = ['science', 'technology', 'research', 'data', 'analysis'];
        const topic = topics[i % topics.length];
        await provider.processDocument(`doc_${i}`, `${topic} content document ${i} with various ${topic} topics`);
      }

      const startTime = Date.now();
      const candidates = await provider.getSmartCandidates('ai_doc', 20);
      const endTime = Date.now();
      
      expect(candidates.length).toBeLessThanOrEqual(20);
      expect(endTime - startTime).toBeLessThan(500); // Should be very fast
    }, 10000); // 10 second timeout

    it('should clear word index when clearing provider', () => {
      const initialStats = provider.getStats();
      expect(initialStats.wordIndex?.totalDocuments).toBeGreaterThan(0);
      
      provider.clear();
      
      const clearedStats = provider.getStats();
      expect(clearedStats.wordIndex?.totalDocuments).toBe(0);
    });
  });
});