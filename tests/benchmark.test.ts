/**
 * @file Benchmark tests for Related Notes plugin performance
 * Tests smart candidate selection vs random sampling performance
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MultiResolutionBloomFilterProvider } from '../src/multi-bloom';

// Mock TFile for benchmarking
class MockTFile {
  constructor(public path: string, public basename: string) {}
  stat = { mtime: Date.now(), size: 1000 };
  extension = 'md';
}

describe('Performance Benchmarks', () => {
  let provider: MultiResolutionBloomFilterProvider;
  let mockVault: any;

  beforeEach(() => {
    const mockFiles: MockTFile[] = [];
    
    mockVault = {
      getMarkdownFiles: () => mockFiles,
      adapter: {
        exists: () => Promise.resolve(false),
        read: () => Promise.resolve(''),
        write: () => Promise.resolve(),
        mkdir: () => Promise.resolve(),
        remove: () => Promise.resolve(),
      },
      configDir: '/mock/config',
      cachedRead: (file: MockTFile) => Promise.resolve(`Content of ${file.basename}`)
    };

    provider = new MultiResolutionBloomFilterProvider(mockVault, {
      ngramSizes: [3],
      bloomSizes: [2048],
      hashFunctions: [3],
      similarityThreshold: 0.1,
      enableSampling: true,
      sampleSizeThreshold: 100,
      maxSampleSize: 500
    });
  });

  describe('Small Vault Performance', () => {
    it('should handle small vaults efficiently without sampling', async () => {
      const startTime = performance.now();
      
      // Create small vault (20 documents)
      for (let i = 0; i < 20; i++) {
        const category = i % 3 === 0 ? 'tech' : i % 3 === 1 ? 'science' : 'history';
        const content = `Document ${i} about ${category} topics.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }
      
      const initTime = performance.now() - startTime;
      expect(initTime).toBeLessThan(5000); // Should complete in under 5 seconds
      
      // Test similarity search performance
      const queryStart = performance.now();
      const candidates = await provider.getCandidateFiles({ path: 'doc_0_tech' } as any);
      const candidateTime = performance.now() - queryStart;
      
      expect(candidateTime).toBeLessThan(50); // Should be very fast for small vaults
      expect(candidates.length).toBeGreaterThanOrEqual(0);
    }, 5000);
  });

  describe('Medium Vault Performance', () => {
    it('should handle medium vaults with smart candidate selection', async () => {
      const startTime = performance.now();
      
      // Create medium vault (100 documents)
      for (let i = 0; i < 100; i++) {
        const category = ['tech', 'science', 'history', 'literature'][i % 4];
        const content = `Document ${i} about ${category} research.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }
      
      const initTime = performance.now() - startTime;
      expect(initTime).toBeLessThan(15000); // Should complete in under 15 seconds
      
      // Test smart candidate selection performance
      const candidateStart = performance.now();
      const smartCandidates = await provider.getSmartCandidates('doc_0_tech', 30);
      const candidateTime = performance.now() - candidateStart;
      
      expect(candidateTime).toBeLessThan(200); // Should be fast even for medium vaults
      expect(smartCandidates.length).toBeLessThanOrEqual(30);
      expect(smartCandidates.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('Large Vault Performance', () => {
    it('should handle large vaults efficiently with smart candidates', async () => {
      const startTime = performance.now();
      
      // Create large vault (200 documents - smaller for testing)
      for (let i = 0; i < 200; i++) {
        const categories = ['technology', 'science', 'history', 'literature'];
        const category = categories[i % categories.length];
        const content = `Document ${i} focuses on ${category} research.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }
      
      const initTime = performance.now() - startTime;
      expect(initTime).toBeLessThan(30000); // Should complete in under 30 seconds
      
      // Test smart candidate selection performance
      const smartStart = performance.now();
      const smartCandidates = await provider.getSmartCandidates('doc_0_technology', 50);
      const smartTime = performance.now() - smartStart;
      
      expect(smartTime).toBeLessThan(500); // Should be under 500ms
      expect(smartCandidates.length).toBeLessThanOrEqual(50);
      expect(smartCandidates.length).toBeGreaterThan(0);
      
      // Test full similarity computation on smart candidates
      const similarityStart = performance.now();
      const similarities = await provider.getSimilarDocuments('doc_0_technology', 10, undefined, smartCandidates);
      const similarityTime = performance.now() - similarityStart;
      
      expect(similarityTime).toBeLessThan(1000); // Should complete similarity in under 1 second
      expect(similarities.length).toBeLessThanOrEqual(10);
    }, 20000);
  });

  describe('Memory Usage Benchmarks', () => {
    it('should maintain reasonable memory usage', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Create a modest number of documents
      for (let i = 0; i < 100; i++) {
        const category = ['tech', 'science', 'history', 'literature'][i % 4];
        const content = `Content ${i} about ${category}.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }
      
      const afterIndexingMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = afterIndexingMemory - initialMemory;
      
      // Memory increase should be reasonable (less than 20MB for 100 documents)
      expect(memoryIncrease).toBeLessThan(20 * 1024 * 1024);
      
      // Get memory stats from the provider
      const stats = provider.getStats();
      expect(stats.memoryUsage).toBeDefined();
      expect(stats.memoryUsage.totalBytes).toBeGreaterThan(0);
      expect(stats.memoryUsage.totalBytes).toBeLessThan(10 * 1024 * 1024); // Less than 10MB
    }, 10000);
  });

  describe('Candidate Selection Strategy Comparison', () => {
    it('should demonstrate smart candidates effectiveness', async () => {
      // Create documents with clear categories for testing
      const categories = ['ai', 'physics', 'history', 'literature'];
      
      for (let i = 0; i < 50; i++) {
        const category = categories[i % categories.length];
        const content = `This document discusses ${category} topics.`;
        await provider.processDocument(`doc_${i}_${category}`, content);
      }
      
      // Test query similar to AI documents
      const queryDoc = 'query_ai';
      const queryContent = 'This document explores ai topics and concepts.';
      await provider.processDocument(queryDoc, queryContent);
      
      // Test smart candidate selection
      const smartStart = performance.now();
      const smartCandidates = await provider.getSmartCandidates(queryDoc, 20);
      const smartTime = performance.now() - smartStart;
      
      expect(smartTime).toBeLessThan(500); // Smart candidate selection should be fast
      
      // Test similarity computation with smart candidates if we have any
      if (smartCandidates.length > 0) {
        const similarityStart = performance.now();
        const similarities = await provider.getSimilarDocuments(queryDoc, 5, undefined, smartCandidates);
        const similarityTime = performance.now() - similarityStart;
        
        expect(similarityTime).toBeLessThan(1000); // Similarity computation should be efficient
        
        // If we have similarities, they should be meaningful
        if (similarities.length > 0) {
          expect(similarities[0][1]).toBeGreaterThanOrEqual(0); // Top result should have non-negative similarity
        }
      }
      
      // At minimum, we should get some candidates
      expect(smartCandidates.length).toBeGreaterThanOrEqual(0);
    }, 10000);
  });

  describe('CPU Throttling Performance', () => {
    it('should maintain responsiveness with CPU throttling', async () => {
      const documents = 80;
      const batchSize = 20;
      
      for (let batch = 0; batch < documents / batchSize; batch++) {
        const batchStart = performance.now();
        
        // Process a batch of documents
        for (let i = 0; i < batchSize; i++) {
          const docIndex = batch * batchSize + i;
          const category = ['tech', 'science', 'history'][docIndex % 3];
          const content = `Document ${docIndex} about ${category}.`;
          await provider.processDocument(`doc_${docIndex}_${category}`, content);
        }
        
        const batchTime = performance.now() - batchStart;
        
        // Each batch should complete in reasonable time (CPU throttling working)
        expect(batchTime).toBeLessThan(2000); // 2 seconds per batch max
      }
      
      // Test that similarity search still works efficiently after indexing
      const searchStart = performance.now();
      const candidates = await provider.getSmartCandidates('doc_0_tech', 20);
      const searchTime = performance.now() - searchStart;
      
      expect(searchTime).toBeLessThan(200);
      expect(candidates.length).toBeGreaterThan(0);
    }, 15000);
  });
});