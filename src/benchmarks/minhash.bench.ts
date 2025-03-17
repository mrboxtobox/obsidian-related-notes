/**
 * @file Benchmarks for the MinHash-LSH implementation
 * Run with: npx vitest bench
 */

import { bench, describe } from 'vitest';
import { MinHashLSH } from '../minhash';
import { SimilarityProviderV2 } from '../core';
import { OptimizedSimilarityProvider } from '../similarity';

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

describe('MinHash-LSH Performance', () => {
  // Generate corpora of different sizes
  const smallCorpus = generateCorpus(100);
  const mediumCorpus = generateCorpus(500);
  const largeCorpus = generateCorpus(1000);

  // Benchmark initialization with different corpus sizes
  bench('Initialize MinHashLSH with 100 documents', async () => {
    const vault = new MockVault(smallCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });

    await minhash.initialize();
  });

  bench('Initialize MinHashLSH with 500 documents', async () => {
    const vault = new MockVault(mediumCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });

    await minhash.initialize();
  });

  bench('Initialize MinHashLSH with 1000 documents', async () => {
    const vault = new MockVault(largeCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });

    await minhash.initialize();
  });

  // Benchmark query performance
  bench('Query similar documents (100 documents)', async () => {
    const vault = new MockVault(smallCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });

    await minhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      minhash.findSimilarDocumentsWithScores(files[randomIndex]);
    }
  });

  bench('Query similar documents (1000 documents)', async () => {
    const vault = new MockVault(largeCorpus);
    const minhash = new MinHashLSH(vault as any, {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    });

    await minhash.initialize();

    // Query 10 random documents
    const files = vault.getMarkdownFiles();
    for (let i = 0; i < 10; i++) {
      const randomIndex = Math.floor(Math.random() * files.length);
      minhash.findSimilarDocumentsWithScores(files[randomIndex]);
    }
  });
});

// Compare original vs optimized implementation
describe('Original vs Optimized Implementation', async () => {
  // Generate a medium-sized corpus
  const corpus = generateCorpus(500);
  const vault = new MockVault(corpus);

  // Initialize both implementations
  const originalProvider = new SimilarityProviderV2(vault as any, {
    numBands: 5,
    rowsPerBand: 2,
    shingleSize: 2,
    priorityIndexSize: 500
  });

  const optimizedProvider = new OptimizedSimilarityProvider(vault as any, {
    minhash: {
      numHashes: 100,
      numBands: 20,
      rowsPerBand: 5,
      shingleSize: 3,
      useWordShingles: true
    },
    similarityThreshold: 0.3,
    maxRelatedNotes: 10
  });

  // Initialize both providers (do this outside the benchmarks)
  await originalProvider.initialize();
  await optimizedProvider.initialize();

  // Get files for testing
  const files = vault.getMarkdownFiles();
  const testFiles = files.slice(0, 10); // Use the first 10 files for testing

  // Benchmark getCandidateFiles
  bench('Original: getCandidateFiles', () => {
    for (const file of testFiles) {
      originalProvider.getCandidateFiles(file);
    }
  });

  bench('Optimized: getCandidateFiles', () => {
    for (const file of testFiles) {
      optimizedProvider.getCandidateFiles(file);
    }
  });

  // Benchmark computeCappedCosineSimilarity
  bench('Original: computeCappedCosineSimilarity', async () => {
    for (const file1 of testFiles.slice(0, 3)) {
      for (const file2 of testFiles.slice(3, 6)) {
        await originalProvider.computeCappedCosineSimilarity(file1, file2);
      }
    }
  });

  bench('Optimized: computeCappedCosineSimilarity', async () => {
    for (const file1 of testFiles.slice(0, 3)) {
      for (const file2 of testFiles.slice(3, 6)) {
        await optimizedProvider.computeCappedCosineSimilarity(file1, file2);
      }
    }
  });
});