/**
 * @file Tests for the MinHash-LSH implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MinHashLSH } from '../minhash';

// Mock TFile and Vault
const mockFile = (path: string) => ({
  path,
  name: path.split('/').pop() || '',
  basename: path.split('/').pop()?.split('.')[0] || '',
  extension: 'md',
  stat: { mtime: Date.now(), ctime: Date.now(), size: 0 }
});

class MockVault {
  private readonly files: Map<string, string> = new Map();
  
  constructor(initialFiles?: Record<string, string>) {
    if (initialFiles) {
      for (const [path, content] of Object.entries(initialFiles)) {
        this.files.set(path, content);
      }
    }
  }
  
  public getMarkdownFiles() {
    return Array.from(this.files.keys()).map(path => mockFile(path));
  }
  
  public addFile(path: string, content: string) {
    this.files.set(path, content);
  }
  
  public cachedRead(file: { path: string }) {
    const content = this.files.get(file.path);
    if (content === undefined) {
      throw new Error(`File not found: ${file.path}`);
    }
    return Promise.resolve(content);
  }
}

// Test document data
const testDocuments = {
  'doc1.md': 'The quick brown fox jumps over the lazy dog',
  'doc2.md': 'The quick brown fox jumps over the fence',
  'doc3.md': 'A lazy dog sleeps in the sun',
  'doc4.md': 'Programming in JavaScript is fun',
  'doc5.md': 'JavaScript programming is enjoyable',
  'doc6.md': 'Python is another programming language',
  'doc7.md': 'Machine learning is a subset of artificial intelligence',
  'doc8.md': 'Artificial intelligence includes machine learning and deep learning',
  'doc9.md': 'Deep learning uses neural networks',
  'doc10.md': 'Completely unrelated document about bananas'
};

describe('MinHashLSH', () => {
  let vault: MockVault;
  let minhash: MinHashLSH;
  
  beforeEach(() => {
    // Create a new mock vault with test documents
    vault = new MockVault(testDocuments);
    
    // Create MinHashLSH with test configuration
    minhash = new MinHashLSH(vault as any, {
      numHashes: 50,      // Fewer hashes for testing
      numBands: 10,       // 10 bands
      rowsPerBand: 5,     // 5 rows per band
      shingleSize: 2,     // Bigrams
      useWordShingles: true // Use word-level shingles
    });
  });
  
  it('should initialize with all documents', async () => {
    // Mock progress callback
    const progressCallback = vi.fn();
    
    // Initialize
    await minhash.initialize(progressCallback);
    
    // Check if progress callback was called
    expect(progressCallback).toHaveBeenCalled();
    
    // Get stats
    const stats = minhash.getStats();
    
    // Check if all documents were indexed
    expect(stats.numDocuments).toBe(Object.keys(testDocuments).length);
  });
  
  it('should find similar documents', async () => {
    // Initialize
    await minhash.initialize();
    
    // Get similar documents for doc1
    const doc1 = mockFile('doc1.md');
    const similars = minhash.findSimilarDocuments(doc1);
    
    // doc2 should be similar to doc1 (both about "quick brown fox")
    const hasSimilar = similars.some(file => file.path === 'doc2.md');
    expect(hasSimilar).toBe(true);
    
    // doc4 should not be similar to doc1
    const hasUnrelated = similars.some(file => file.path === 'doc4.md');
    expect(hasUnrelated).toBe(false);
  });
  
  it('should find similar documents with scores', async () => {
    // Initialize
    await minhash.initialize();
    
    // Get similar documents for doc4
    const doc4 = mockFile('doc4.md');
    const similars = minhash.findSimilarDocumentsWithScores(doc4);
    
    // doc5 should be similar to doc4 (both about "JavaScript programming")
    const hasSimilar = similars.some(item => item.file2.path === 'doc5.md');
    expect(hasSimilar).toBe(true);
    
    // All similarities should be between 0 and 1
    for (const item of similars) {
      expect(item.estimatedSimilarity).toBeGreaterThanOrEqual(0);
      expect(item.estimatedSimilarity).toBeLessThanOrEqual(1);
    }
    
    // Results should be sorted by similarity (highest first)
    for (let i = 1; i < similars.length; i++) {
      expect(similars[i - 1].estimatedSimilarity).toBeGreaterThanOrEqual(similars[i].estimatedSimilarity);
    }
  });
  
  it('should respect the minimum similarity threshold', async () => {
    // Initialize
    await minhash.initialize();
    
    // Get similar documents for doc7
    const doc7 = mockFile('doc7.md');
    
    // With high threshold
    const highThreshold = minhash.findSimilarDocumentsWithScores(doc7, 0.8);
    expect(highThreshold.length).toBeLessThanOrEqual(1);
    
    // With low threshold
    const lowThreshold = minhash.findSimilarDocumentsWithScores(doc7, 0.1);
    expect(lowThreshold.length).toBeGreaterThan(highThreshold.length);
  });
  
  it('should update and remove documents correctly', async () => {
    // Initialize
    await minhash.initialize();
    
    // Check initial stats
    const initialStats = minhash.getStats();
    
    // Add a new document
    const newDoc = mockFile('new-doc.md');
    vault.addFile('new-doc.md', 'This is a new document about machine learning');
    await minhash.addDocument(newDoc);
    
    // Check stats after adding
    const statsAfterAdd = minhash.getStats();
    expect(statsAfterAdd.numDocuments).toBe(initialStats.numDocuments + 1);
    
    // Remove the document
    minhash.removeDocument('new-doc.md');
    
    // Check stats after removing
    const statsAfterRemove = minhash.getStats();
    expect(statsAfterRemove.numDocuments).toBe(initialStats.numDocuments);
  });
  
  it('should handle document updates', async () => {
    // Initialize
    await minhash.initialize();
    
    // Get similar documents for doc1
    const doc1 = mockFile('doc1.md');
    const initialSimilars = minhash.findSimilarDocuments(doc1);
    
    // Update doc1 content to be more similar to doc3
    vault.addFile('doc1.md', 'A lazy dog jumps around');
    await minhash.updateDocument(doc1);
    
    // Get similar documents after update
    const updatedSimilars = minhash.findSimilarDocuments(doc1);
    
    // doc3 should now be similar to doc1
    const hasDoc3 = updatedSimilars.some(file => file.path === 'doc3.md');
    expect(hasDoc3).toBe(true);
  });
});