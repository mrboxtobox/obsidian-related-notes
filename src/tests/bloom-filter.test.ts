import { BloomFilter, BloomFilterSimilarityProvider } from '../bloom';

// Test the bloom filter implementation
describe('BloomFilter', () => {
  test('should add items and check for containment', () => {
    const filter = new BloomFilter(256, 3);
    filter.add('test');
    filter.add('example');
    
    expect(filter.contains('test')).toBe(true);
    expect(filter.contains('example')).toBe(true);
    expect(filter.contains('unknown')).toBe(false);
  });
  
  test('should calculate similarity between two filters', () => {
    const filter1 = new BloomFilter(256, 3);
    const filter2 = new BloomFilter(256, 3);
    
    // Add some common items
    filter1.add('test');
    filter1.add('example');
    filter1.add('common');
    
    filter2.add('example');
    filter2.add('common');
    filter2.add('unique');
    
    // Should have some similarity due to common items
    const similarity = filter1.similarity(filter2);
    expect(similarity).toBeGreaterThan(0);
    expect(similarity).toBeLessThan(1);
  });
  
  test('should have high similarity for identical filters', () => {
    const filter1 = new BloomFilter(256, 3);
    const filter2 = new BloomFilter(256, 3);
    
    const items = ['test', 'example', 'common', 'items', 'more'];
    
    // Add same items to both filters
    for (const item of items) {
      filter1.add(item);
      filter2.add(item);
    }
    
    // Should have perfect or near-perfect similarity
    const similarity = filter1.similarity(filter2);
    expect(similarity).toBeGreaterThanOrEqual(0.9);
  });
});

// Test the bloom filter similarity provider
describe('BloomFilterSimilarityProvider', () => {
  test('should process documents and calculate similarity', () => {
    const provider = new BloomFilterSimilarityProvider(3, 256, 3);
    
    // Process some documents
    provider.processDocument('doc1', 'This is a test document with some example content');
    provider.processDocument('doc2', 'This is another document with some similar example content');
    provider.processDocument('doc3', 'This document is completely different from the others');
    
    // Calculate similarities
    const sim12 = provider.calculateSimilarity('doc1', 'doc2');
    const sim13 = provider.calculateSimilarity('doc1', 'doc3');
    const sim23 = provider.calculateSimilarity('doc2', 'doc3');
    
    // doc1 and doc2 should be more similar than doc1 and doc3
    expect(sim12).toBeGreaterThan(sim13);
    
    // doc2 and doc3 might also be somewhat similar due to common words
    expect(sim23).toBeGreaterThan(0);
  });
  
  test('should get similar documents in order', () => {
    const provider = new BloomFilterSimilarityProvider(3, 256, 3);
    
    // Process some documents
    provider.processDocument('doc1', 'This is a test document with some example content');
    provider.processDocument('doc2', 'This is another document with some similar example content');
    provider.processDocument('doc3', 'This document is completely different from the others');
    provider.processDocument('doc4', 'Yet another completely unrelated document about something else');
    
    // Get similar documents to doc1
    const results = provider.getSimilarDocuments('doc1', 3, 0.01);
    
    // Should return at least doc2 as similar
    expect(results.length).toBeGreaterThan(0);
    
    // First result should be most similar
    if (results.length > 1) {
      expect(results[0][1]).toBeGreaterThanOrEqual(results[1][1]);
    }
    
    // doc2 should be among the results and probably the most similar
    const hasDoc2 = results.some(([docId]) => docId === 'doc2');
    expect(hasDoc2).toBe(true);
  });
});