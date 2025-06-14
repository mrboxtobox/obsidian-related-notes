// Quick test script to see the bloom filter in action
const fs = require('fs');
const path = require('path');

// Find the path to the built main.js file
const pluginDir = __dirname;
const mainJsPath = path.join(pluginDir, 'main.js');

// Import the bloom filter module (this won't work directly, but we'll simulate it)
// Instead, we'll create a simple bloom filter implementation here for testing
class BloomFilter {
  constructor(size = 256, hashFunctions = 3) {
    this.size = Math.ceil(size / 32) * 32;
    this.bitArray = new Uint32Array(this.size / 32);
    this.hashFunctions = hashFunctions;
    this.addedItems = new Set();
    
    console.log(`[BloomFilter] Created bloom filter with ${this.size} bits and ${hashFunctions} hash functions`);
    console.log(`[BloomFilter] Memory usage: ${this.size / 8} bytes (${this.size / 8 / 1024} KB)`);
  }
  
  add(item) {
    this.addedItems.add(item);
    
    const hashes = this.getHashes(item);
    if (item.length < 10) {
      console.log(`[BloomFilter] Adding item: "${item}" with hashes:`, hashes.map(h => h % this.size));
    }
    
    for (const hash of hashes) {
      const bitIndex = hash % this.size;
      const arrayIndex = Math.floor(bitIndex / 32);
      const bitOffset = bitIndex % 32;
      this.bitArray[arrayIndex] |= 1 << bitOffset;
    }
  }
  
  contains(item) {
    const hashes = this.getHashes(item);
    for (const hash of hashes) {
      const bitIndex = hash % this.size;
      const arrayIndex = Math.floor(bitIndex / 32);
      const bitOffset = bitIndex % 32;
      if (!(this.bitArray[arrayIndex] & (1 << bitOffset))) {
        return false;
      }
    }
    return true;
  }
  
  similarity(other) {
    if (this.size !== other.size) {
      throw new Error('Bloom filters must be the same size for comparison');
    }

    let intersectionBits = 0;
    let unionBits = 0;
    let thisBits = 0;
    let otherBits = 0;

    for (let i = 0; i < this.bitArray.length; i++) {
      const intersection = this.bitArray[i] & other.bitArray[i];
      const union = this.bitArray[i] | other.bitArray[i];
      
      // Count bits in each array
      const thisCount = countBits(this.bitArray[i]);
      const otherCount = countBits(other.bitArray[i]);
      
      // Count bits in intersection and union
      intersectionBits += countBits(intersection);
      unionBits += countBits(union);
      
      thisBits += thisCount;
      otherBits += otherCount;
    }

    const similarity = unionBits === 0 ? 0 : intersectionBits / unionBits;
    
    console.log(
      `[BloomFilter] Similarity details:
        - Filter 1: ${thisBits} bits set (${(thisBits / this.size * 100).toFixed(2)}% of capacity)
        - Filter 2: ${otherBits} bits set (${(otherBits / this.size * 100).toFixed(2)}% of capacity)
        - Intersection: ${intersectionBits} bits
        - Union: ${unionBits} bits
        - Items in filter 1: ${this.addedItems.size}
        - Items in filter 2: ${other.addedItems.size}
        - Common items (estimated): ${Math.round(intersectionBits / (this.hashFunctions + other.hashFunctions) * 2)}
        - Jaccard similarity: ${(similarity * 100).toFixed(2)}%`
    );
      
    // Log a sample of items that were added to both filters
    const commonItems = [...this.addedItems].filter(item => other.addedItems.has(item));
    if (commonItems.length > 0) {
      console.log(`[BloomFilter] First 5 common items: ${commonItems.slice(0, 5).join(', ')}`);
    }

    return similarity;
  }
  
  getHashes(item) {
    const hashes = [];

    // FNV-1a hash
    const fnv1a = (str) => {
      let hash = 2166136261; // FNV offset basis
      for (let i = 0; i < str.length; i++) {
        hash ^= str.charCodeAt(i);
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
      }
      return hash >>> 0; // Convert to unsigned 32-bit integer
    };

    // djb2 hash
    const djb2 = (str) => {
      let hash = 5381;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) + str.charCodeAt(i);
      }
      return hash >>> 0;
    };

    // sdbm hash
    const sdbm = (str) => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + (hash << 6) + (hash << 16) - hash;
      }
      return hash >>> 0;
    };

    const baseHash = fnv1a(item);
    hashes.push(baseHash);
    if (this.hashFunctions > 1) hashes.push(djb2(item));
    if (this.hashFunctions > 2) hashes.push(sdbm(item));

    for (let i = 3; i < this.hashFunctions; i++) {
      hashes.push((hashes[0] + i * hashes[1]) >>> 0);
    }

    return hashes;
  }
}

function countBits(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return ((n + (n >> 4) & 0xF0F0F0F) * 0x1010101) >> 24;
}

class BloomFilterSimilarityProvider {
  constructor(ngramSize = 3, bloomFilterSize = 256, hashFunctions = 3) {
    this.ngramSize = ngramSize;
    this.bloomFilterSize = bloomFilterSize;
    this.hashFunctions = hashFunctions;
    this.bloomFilters = new Map();
    this.documentNgrams = new Map();
    
    console.log(`[BloomFilter] Created BloomFilterSimilarityProvider with:
      - n-gram size: ${ngramSize}
      - bloom filter size: ${bloomFilterSize} bits
      - hash functions: ${hashFunctions}
      - memory per document: ${bloomFilterSize / 8} bytes`);
  }
  
  extractNgrams(text) {
    const startTime = performance.now();
    
    // Simple tokenization for testing
    const processed = text.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Extract character n-grams
    const ngrams = new Set();
    const chars = processed.replace(/\s+/g, ' ').toLowerCase();
    
    for (let i = 0; i <= chars.length - this.ngramSize; i++) {
      ngrams.add(chars.substring(i, i + this.ngramSize));
    }
    
    const endTime = performance.now();
    
    // Only log if we have few enough n-grams to display
    const sampleSize = Math.min(10, ngrams.size);
    if (ngrams.size < 100) {
      const sample = Array.from(ngrams).slice(0, sampleSize);
      console.log(`[BloomFilter] Extracted ${ngrams.size} n-grams in ${(endTime - startTime).toFixed(2)}ms. Sample: ${sample.join(', ')}`);
    } else {
      console.log(`[BloomFilter] Extracted ${ngrams.size} n-grams in ${(endTime - startTime).toFixed(2)}ms`);
    }
    
    return ngrams;
  }
  
  processDocument(docId, text) {
    const startTime = performance.now();
    
    // Create a bloom filter with the specified size and hash functions
    const filter = new BloomFilter(this.bloomFilterSize, this.hashFunctions);
    const ngrams = this.extractNgrams(text);
    
    // Store n-grams for debugging
    this.documentNgrams.set(docId, ngrams);
    
    // Add each n-gram to the bloom filter
    for (const ngram of ngrams) {
      filter.add(ngram);
    }
    
    // Store the bloom filter
    this.bloomFilters.set(docId, filter);
    
    // Log processing time and stats
    const endTime = performance.now();
    
    console.log(`[BloomFilter] Processed document ${docId}:
      - Length: ${text.length} characters
      - Extracted ${ngrams.size} unique n-grams
      - Filter size: ${this.bloomFilterSize} bits (${this.bloomFilterSize / 8} bytes)
      - Processing time: ${(endTime - startTime).toFixed(2)}ms`);
  }
  
  calculateSimilarity(docId1, docId2) {
    const startTime = performance.now();
    
    // Get the bloom filters for both documents
    const filter1 = this.bloomFilters.get(docId1);
    const filter2 = this.bloomFilters.get(docId2);
    
    // If either filter is missing, return 0
    if (!filter1 || !filter2) {
      if (!filter1) console.log(`[BloomFilter] Document ${docId1} not found`);
      if (!filter2) console.log(`[BloomFilter] Document ${docId2} not found`);
      return 0;
    }
    
    // Calculate the actual Jaccard similarity
    const similarity = filter1.similarity(filter2);
    
    const endTime = performance.now();
    
    // Calculate the actual n-gram overlap for comparison with the bloom filter estimation
    const ngrams1 = this.documentNgrams.get(docId1);
    const ngrams2 = this.documentNgrams.get(docId2);
    
    if (ngrams1 && ngrams2) {
      // Calculate actual Jaccard similarity of n-grams
      const intersection = new Set([...ngrams1].filter(x => ngrams2.has(x)));
      const union = new Set([...ngrams1, ...ngrams2]);
      const actualSimilarity = intersection.size / union.size;
      
      console.log(`[BloomFilter] Similarity calculation for ${docId1} and ${docId2}:
        - Bloom filter similarity: ${(similarity * 100).toFixed(2)}%
        - Actual n-gram Jaccard similarity: ${(actualSimilarity * 100).toFixed(2)}%
        - Estimation error: ${Math.abs(similarity - actualSimilarity).toFixed(4)}
        - Common n-grams: ${intersection.size} of ${ngrams1.size}/${ngrams2.size}
        - Calculation time: ${(endTime - startTime).toFixed(2)}ms`);
    } else {
      console.log(`[BloomFilter] Similarity calculation for ${docId1} and ${docId2}: ${(similarity * 100).toFixed(2)}%`);
    }
    
    return similarity;
  }
}

// Run a test
console.log("==== BLOOM FILTER SIMILARITY TEST ====");

// Initialize the similarity provider
const provider = new BloomFilterSimilarityProvider(3, 256, 3);

// Test with some documents
const doc1 = "This is a test document about apples and bananas. It contains some information about fruits that are commonly eaten.";
const doc2 = "Apples and bananas are common fruits that people eat. This document is about different types of fruits.";
const doc3 = "This document is about programming in JavaScript. It has nothing to do with fruits or food.";

// Process the documents
provider.processDocument("doc1", doc1);
provider.processDocument("doc2", doc2);
provider.processDocument("doc3", doc3);

// Calculate similarities
console.log("\n==== SIMILARITY CALCULATIONS ====");
const sim12 = provider.calculateSimilarity("doc1", "doc2");
const sim13 = provider.calculateSimilarity("doc1", "doc3");
const sim23 = provider.calculateSimilarity("doc2", "doc3");

// Print summary
console.log("\n==== SUMMARY ====");
console.log(`Similarity between doc1 and doc2: ${(sim12 * 100).toFixed(2)}%`);
console.log(`Similarity between doc1 and doc3: ${(sim13 * 100).toFixed(2)}%`);
console.log(`Similarity between doc2 and doc3: ${(sim23 * 100).toFixed(2)}%`);

// Test with different bloom filter sizes
console.log("\n==== TESTING DIFFERENT BLOOM FILTER SIZES ====");
for (const size of [128, 256, 512, 1024, 2048, 4096]) {
  const provider = new BloomFilterSimilarityProvider(3, size, 3);
  provider.processDocument("doc1", doc1);
  provider.processDocument("doc2", doc2);
  const sim = provider.calculateSimilarity("doc1", "doc2");
  console.log(`Bloom filter size ${size} bits: similarity = ${(sim * 100).toFixed(2)}%`);
}

// Test with different hash function counts
console.log("\n==== TESTING DIFFERENT HASH FUNCTION COUNTS ====");
for (const hashFunctions of [1, 2, 3, 4, 5]) {
  const provider = new BloomFilterSimilarityProvider(3, 256, hashFunctions);
  provider.processDocument("doc1", doc1);
  provider.processDocument("doc2", doc2);
  const sim = provider.calculateSimilarity("doc1", "doc2");
  console.log(`${hashFunctions} hash functions: similarity = ${(sim * 100).toFixed(2)}%`);
}

// Test with different n-gram sizes
console.log("\n==== TESTING DIFFERENT N-GRAM SIZES ====");
for (const ngramSize of [2, 3, 4, 5]) {
  const provider = new BloomFilterSimilarityProvider(ngramSize, 256, 3);
  provider.processDocument("doc1", doc1);
  provider.processDocument("doc2", doc2);
  const sim = provider.calculateSimilarity("doc1", "doc2");
  console.log(`${ngramSize}-gram size: similarity = ${(sim * 100).toFixed(2)}%`);
}