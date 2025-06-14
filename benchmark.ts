/**
 * Benchmark script for Related Notes plugin
 * 
 * This script compares the performance of different similarity algorithms
 * used in the Related Notes plugin.
 */

// Mock vault for testing
class MockVault {
  private files: { name: string, content: string }[] = [];

  constructor(numFiles: number, contentLength: number) {
    // Generate files with random content
    for (let i = 0; i < numFiles; i++) {
      const name = `file_${i.toString().padStart(5, '0')}.md`;
      const content = this.generateRandomContent(contentLength);
      this.files.push({ name, content });
    }
  }

  getMarkdownFiles() {
    return this.files.map(file => ({ 
      name: file.name, 
      path: file.name,
      basename: file.name.replace('.md', ''),
      extension: 'md'
    }));
  }

  async read(fileName: string): Promise<string> {
    const file = this.files.find(f => f.name === fileName);
    if (!file) {
      throw new Error(`File not found: ${fileName}`);
    }
    return file.content;
  }

  cachedRead(file: any): Promise<string> {
    return this.read(file.name);
  }

  adapter = {
    exists: async () => false,
    read: async () => '',
    write: async () => {}
  };

  configDir = '';

  // Generate random content with some repeated terms for similarity
  private generateRandomContent(length: number): string {
    const terms = [
      'obsidian', 'note', 'taking', 'knowledge', 'management',
      'graph', 'link', 'markdown', 'tag', 'folder', 'file',
      'plugin', 'theme', 'vault', 'sync', 'mobile', 'desktop',
      'daily', 'note', 'template', 'search', 'filter', 'sort',
      'canvas', 'pdf', 'image', 'embed', 'backlink', 'reference'
    ];

    const paragraphs = [];
    const numParagraphs = Math.ceil(length / 200);

    for (let i = 0; i < numParagraphs; i++) {
      const paragraphLength = Math.floor(Math.random() * 100) + 100;
      let paragraph = '';

      while (paragraph.length < paragraphLength) {
        const term = terms[Math.floor(Math.random() * terms.length)];
        paragraph += term + ' ';
      }

      paragraphs.push(paragraph.trim());
    }

    return paragraphs.join('\n\n');
  }
}

// Import similarity algorithms
import { tokenize, SimilarityProviderV2 } from './src/core';
import { BloomFilterSimilarityProvider } from './src/bloom';

// Benchmark parameters
const VAULT_SIZES = [100, 500, 1000, 5000];
const CONTENT_LENGTH = 1000;
const RUNS = 3;

async function runBenchmark() {
  console.log('Running Related Notes Benchmark');
  console.log('===============================');
  console.log('');
  
  for (const vaultSize of VAULT_SIZES) {
    console.log(`Vault Size: ${vaultSize} files`);
    console.log('---------------------------------');
    
    // Create mock vault
    const vault = new MockVault(vaultSize, CONTENT_LENGTH);
    const files = vault.getMarkdownFiles();
    
    // Benchmark MinHash LSH Provider
    console.log('MinHash LSH Provider:');
    const minhashTimes = [];
    
    for (let i = 0; i < RUNS; i++) {
      const minhashProvider = new SimilarityProviderV2(vault as any, {
        numBands: 5,
        rowsPerBand: 2,
        shingleSize: 2,
        batchSize: 10,
        priorityIndexSize: vaultSize, // Index all files
        useBloomFilter: false
      });
      
      const minhashStartTime = Date.now();
      await minhashProvider.initialize(() => {});
      const minhashEndTime = Date.now();
      
      minhashTimes.push(minhashEndTime - minhashStartTime);
      
      // Benchmark similarity computation for 10 random pairs
      let minhashSimTime = 0;
      for (let j = 0; j < 10; j++) {
        const file1 = files[Math.floor(Math.random() * files.length)];
        const file2 = files[Math.floor(Math.random() * files.length)];
        
        const simStartTime = Date.now();
        await minhashProvider.computeCappedCosineSimilarity(file1 as any, file2 as any);
        const simEndTime = Date.now();
        
        minhashSimTime += (simEndTime - simStartTime);
      }
      
      console.log(`  Run ${i+1}: Indexing: ${minhashTimes[i]}ms, Avg Similarity: ${minhashSimTime / 10}ms`);
    }
    
    const avgMinhashTime = minhashTimes.reduce((a, b) => a + b, 0) / RUNS;
    console.log(`  Average Indexing Time: ${avgMinhashTime}ms`);
    
    // Benchmark Bloom Filter Provider
    console.log('Bloom Filter Provider:');
    const bloomTimes = [];
    
    for (let i = 0; i < RUNS; i++) {
      const bloomProvider = new SimilarityProviderV2(vault as any, {
        numBands: 5,
        rowsPerBand: 2,
        shingleSize: 2,
        batchSize: 10,
        priorityIndexSize: vaultSize, // Index all files
        useBloomFilter: true,
        bloomFilterSize: 256,
        bloomFilterHashFunctions: 3,
        ngramSize: 3
      });
      
      const bloomStartTime = Date.now();
      await bloomProvider.initialize(() => {});
      const bloomEndTime = Date.now();
      
      bloomTimes.push(bloomEndTime - bloomStartTime);
      
      // Benchmark similarity computation for 10 random pairs
      let bloomSimTime = 0;
      for (let j = 0; j < 10; j++) {
        const file1 = files[Math.floor(Math.random() * files.length)];
        const file2 = files[Math.floor(Math.random() * files.length)];
        
        const simStartTime = Date.now();
        await bloomProvider.computeCappedCosineSimilarity(file1 as any, file2 as any);
        const simEndTime = Date.now();
        
        bloomSimTime += (simEndTime - simStartTime);
      }
      
      console.log(`  Run ${i+1}: Indexing: ${bloomTimes[i]}ms, Avg Similarity: ${bloomSimTime / 10}ms`);
    }
    
    const avgBloomTime = bloomTimes.reduce((a, b) => a + b, 0) / RUNS;
    console.log(`  Average Indexing Time: ${avgBloomTime}ms`);
    
    // Calculate improvement
    const improvement = ((avgMinhashTime - avgBloomTime) / avgMinhashTime) * 100;
    console.log(`  Bloom Filter is ${improvement.toFixed(2)}% ${improvement > 0 ? 'faster' : 'slower'}`);
    
    console.log('');
  }
  
  console.log('Memory Usage Test');
  console.log('----------------');
  const memoryVaultSize = 10000; // Large vault for memory test
  const memoryVault = new MockVault(memoryVaultSize, CONTENT_LENGTH);
  
  // MinHash memory usage
  global.gc && global.gc(); // Force garbage collection if available
  const memBefore = process.memoryUsage().heapUsed / 1024 / 1024;
  
  const minhashProvider = new SimilarityProviderV2(memoryVault as any, {
    numBands: 5,
    rowsPerBand: 2,
    shingleSize: 2,
    batchSize: 10,
    priorityIndexSize: 5000, // Index half the vault
    useBloomFilter: false
  });
  
  await minhashProvider.initialize(() => {});
  
  global.gc && global.gc(); // Force garbage collection if available
  const memAfterMinhash = process.memoryUsage().heapUsed / 1024 / 1024;
  const minhashMemory = memAfterMinhash - memBefore;
  
  // Bloom filter memory usage
  global.gc && global.gc(); // Force garbage collection if available
  const memBeforeBloom = process.memoryUsage().heapUsed / 1024 / 1024;
  
  const bloomProvider = new SimilarityProviderV2(memoryVault as any, {
    numBands: 5,
    rowsPerBand: 2,
    shingleSize: 2,
    batchSize: 10,
    priorityIndexSize: 5000, // Index half the vault
    useBloomFilter: true,
    bloomFilterSize: 256,
    bloomFilterHashFunctions: 3,
    ngramSize: 3
  });
  
  await bloomProvider.initialize(() => {});
  
  global.gc && global.gc(); // Force garbage collection if available
  const memAfterBloom = process.memoryUsage().heapUsed / 1024 / 1024;
  const bloomMemory = memAfterBloom - memBeforeBloom;
  
  console.log(`MinHash Memory Usage: ${minhashMemory.toFixed(2)} MB`);
  console.log(`Bloom Filter Memory Usage: ${bloomMemory.toFixed(2)} MB`);
  console.log(`Memory Reduction: ${((minhashMemory - bloomMemory) / minhashMemory * 100).toFixed(2)}%`);
}

// Run the benchmark
runBenchmark().catch(console.error);