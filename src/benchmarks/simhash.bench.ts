/**
 * @file Benchmarks for the SimHash implementation
 * Run with: npx vitest bench
 */

import { bench, describe } from 'vitest';
import { SimHash } from '../simhash';
import { MinHashLSH } from '../minhash';

// Mock TFile and Vault with larger dataset
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

// Generate a large corpus of documents for benchmarking
function generateCorpus(size: number): Record<string, string> {
  const corpus: Record<string, string> = {};

  // Define topics with related terms
  const topics = [
    {
      name: 'programming',
      terms: ['code', 'function', 'variable', 'class', 'object', 'method', 'interface', 'algorithm', 'library', 'compiler']
    },
    {
      name: 'machine_learning',
      terms: ['model', 'training', 'feature', 'classification', 'regression', 'neural', 'dataset', 'prediction', 'accuracy', 'loss']
    },
    {
      name: 'history',
      terms: ['ancient', 'medieval', 'renaissance', 'revolution', 'empire', 'king', 'queen', 'war', 'civilization', 'artifact']
    },
    {
      name: 'biology',
      terms: ['cell', 'organism', 'evolution', 'species', 'ecosystem', 'genetics', 'protein', 'tissue', 'metabolism', 'reproduction']
    },
    {
      name: 'physics',
      terms: ['energy', 'force', 'mass', 'velocity', 'acceleration', 'gravity', 'quantum', 'relativity', 'particle', 'wave']
    }
  ];

  // Generate documents for each topic
  for (let i = 0; i < size; i++) {
    const topicIndex = i % topics.length;
    const topic = topics[topicIndex];

    // Create document with terms from the topic
    let content = `This is a document about ${topic.name}.`;

    // Add 20-50 sentences with terms from the topic
    const numSentences = 20 + Math.floor(Math.random() * 30);

    for (let j = 0; j < numSentences; j++) {
      const numTerms = 1 + Math.floor(Math.random() * 4);
      let sentence = 'It discusses ';

      for (let k = 0; k < numTerms; k++) {
        const termIndex = Math.floor(Math.random() * topic.terms.length);
        sentence += topic.terms[termIndex] + ' ';

        // Occasionally add terms from other topics (10% chance)
        if (Math.random() < 0.1) {
          const otherTopicIndex = (topicIndex + 1 + Math.floor(Math.random() * (topics.length - 1))) % topics.length;
          const otherTopic = topics[otherTopicIndex];
          const otherTermIndex = Math.floor(Math.random() * otherTopic.terms.length);
          sentence += otherTopic.terms[otherTermIndex] + ' ';
        }
      }

      sentence += 'and other concepts.';
      content += ' ' + sentence;
    }

    corpus[`doc_${i}.md`] = content;
  }

  return corpus;
}

describe('SimHash vs MinHash Performance', () => {
  // Generate corpora of different sizes
  const smallCorpus = generateCorpus(100);
  const mediumCorpus = generateCorpus(500);
  const largeCorpus = generateCorpus(1000);
  const veryLargeCorpus = generateCorpus(5000);

  // Benchmark memory usage and indexing time
  bench('SimHash: Index 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();
    const stats = simhash.getStats();
    console.log(`SimHash 100 docs: ${stats.memoryUsageBytes} bytes, ${stats.indexingTimeMs.toFixed(2)}ms`);
  });

  bench('MinHash: Index 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3
    });

    const startTime = performance.now();
    await minhash.initialize();
    const indexTime = performance.now() - startTime;
    const stats = minhash.getStats();
    console.log(`MinHash 100 docs: ~${estimateMinHashMemory(stats)} bytes, ${indexTime.toFixed(2)}ms`);
  });

  bench('SimHash: Index 1000 documents', async () => {
    const vault = new MockVault(largeCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();
    const stats = simhash.getStats();
    console.log(`SimHash 1000 docs: ${stats.memoryUsageBytes} bytes, ${stats.indexingTimeMs.toFixed(2)}ms`);
  });

  bench('MinHash: Index 1000 documents', async () => {
    const vault = new MockVault(largeCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3
    });

    const startTime = performance.now();
    await minhash.initialize();
    const indexTime = performance.now() - startTime;
    const stats = minhash.getStats();
    console.log(`MinHash 1000 docs: ~${estimateMinHashMemory(stats)} bytes, ${indexTime.toFixed(2)}ms`);
  });

  // Test with very large corpus (5000 docs)
  bench('SimHash: Index 5000 documents', async () => {
    const vault = new MockVault(veryLargeCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();
    const stats = simhash.getStats();
    console.log(`SimHash 5000 docs: ${stats.memoryUsageBytes} bytes, ${stats.indexingTimeMs.toFixed(2)}ms`);
  });

  // Benchmark query performance
  bench('SimHash: Query 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    const queryStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      simhash.findSimilarDocuments(files[randomIndex]);
    }
    
    const queryTime = performance.now() - queryStartTime;
    console.log(`SimHash query 100 docs (10 queries): ${queryTime.toFixed(2)}ms, ${(queryTime / 10).toFixed(2)}ms per query`);
  });

  bench('MinHash: Query 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3
    });

    await minhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    const queryStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      minhash.findSimilarDocumentsWithScores(files[randomIndex]);
    }
    
    const queryTime = performance.now() - queryStartTime;
    console.log(`MinHash query 100 docs (10 queries): ${queryTime.toFixed(2)}ms, ${(queryTime / 10).toFixed(2)}ms per query`);
  });

  bench('SimHash: Query 1000 documents', async () => {
    const vault = new MockVault(largeCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    const queryStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      simhash.findSimilarDocuments(files[randomIndex]);
    }
    
    const queryTime = performance.now() - queryStartTime;
    console.log(`SimHash query 1000 docs (10 queries): ${queryTime.toFixed(2)}ms, ${(queryTime / 10).toFixed(2)}ms per query`);
  });

  bench('MinHash: Query 1000 documents', async () => {
    const vault = new MockVault(largeCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3
    });

    await minhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    const queryStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      minhash.findSimilarDocumentsWithScores(files[randomIndex]);
    }
    
    const queryTime = performance.now() - queryStartTime;
    console.log(`MinHash query 1000 docs (10 queries): ${queryTime.toFixed(2)}ms, ${(queryTime / 10).toFixed(2)}ms per query`);
  });
  
  // Test with very large corpus (5000 docs)
  bench('SimHash: Query 5000 documents', async () => {
    const vault = new MockVault(veryLargeCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    const queryStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      simhash.findSimilarDocuments(files[randomIndex]);
    }
    
    const queryTime = performance.now() - queryStartTime;
    console.log(`SimHash query 5000 docs (10 queries): ${queryTime.toFixed(2)}ms, ${(queryTime / 10).toFixed(2)}ms per query`);
  });
  
  // Benchmark incremental update performance
  bench('SimHash: Incremental update 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const simhash = new SimHash(vault as any, {
      hashBits: 64,
      shingleSize: 2,
      useChunkIndex: true
    });

    await simhash.initialize();
    
    // Update 10 random documents
    const files = vault.getMarkdownFiles();
    const updateStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      const file = files[randomIndex];
      const newContent = `Updated content for ${file.path}. This document now discusses quantum computing and neural networks.`;
      vault.addFile(file.path, newContent);
      await simhash.updateDocument(file);
    }
    
    const updateTime = performance.now() - updateStartTime;
    console.log(`SimHash update 100 docs (10 updates): ${updateTime.toFixed(2)}ms, ${(updateTime / 10).toFixed(2)}ms per update`);
  });
  
  bench('MinHash: Incremental update 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3
    });

    await minhash.initialize();
    
    // Update 10 random documents
    const files = vault.getMarkdownFiles();
    const updateStartTime = performance.now();
    
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      const file = files[randomIndex];
      const newContent = `Updated content for ${file.path}. This document now discusses quantum computing and neural networks.`;
      vault.addFile(file.path, newContent);
      await minhash.updateDocument(file);
    }
    
    const updateTime = performance.now() - updateStartTime;
    console.log(`MinHash update 100 docs (10 updates): ${updateTime.toFixed(2)}ms, ${(updateTime / 10).toFixed(2)}ms per update`);
  });
});

// Helper function to estimate MinHash memory usage
function estimateMinHashMemory(stats: any): number {
  // Each signature is a Uint32Array with numHashes elements (4 bytes each)
  const signaturesSize = stats.numDocuments * stats.numHashes * 4;
  
  // LSH buckets: roughly estimate based on number of documents and buckets
  const lshBucketsSize = stats.totalBuckets * stats.avgBucketSize * 20; // 20 bytes per entry (rough estimate)
  
  // Cache size: each entry is a cached similarity value (key ~40 bytes, value 8 bytes)
  const cacheSize = stats.cacheSize * 48;
  
  // Other overhead: roughly 100 bytes per document for TFile references and other maps
  const overhead = stats.numDocuments * 100;
  
  return signaturesSize + lshBucketsSize + cacheSize + overhead;
}