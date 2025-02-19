/**
 * @file Configuration settings for the Related Notes plugin algorithms.
 * Centralizes core algorithmic parameters for MinHash LSH and BM25.
 */

export interface AlgorithmConfig {
  // MinHash LSH Configuration
  minHash: {
    numHashes: number;      // Number of hash functions to use
    numBands: number;       // Number of bands for LSH
    bandSize: number;       // Size of each band (derived from numHashes/numBands)
    fuzzyDistance: number;  // Maximum edit distance for fuzzy matching
  };

  // BM25 Configuration
  bm25: {
    k1: number;  // Term frequency saturation parameter
    b: number;   // Length normalization parameter
  };

  // MinHash LSH + BM25 Scoring
  minhashLsh: {
    titleWeight: number;    // Weight multiplier for title matches
  };

  // Processing Configuration
  processing: {
    batchSize: {
      indexing: number;     // Batch size for initial indexing
      search: number;       // Batch size for similarity search
      lsh: number;         // Batch size for LSH operations
    };
    delayBetweenBatches: number;  // Milliseconds to wait between batches
  };
}

export const DEFAULT_CONFIG: AlgorithmConfig = {
  minHash: {
    numHashes: 100,
    numBands: 20,
    bandSize: 5,  // Derived from numHashes/numBands
    fuzzyDistance: 1
  },

  bm25: {
    k1: 1.5,  // Increased to give more weight to term frequency
    b: 0.85   // Increased to give more weight to document length normalization
  },

  minhashLsh: {
    titleWeight: 2.0
  },

  processing: {
    batchSize: {
      indexing: 3,  // Process 3 files at a time during initial indexing
      search: 2,    // Process 2 files at a time during similarity search
      lsh: 3        // Process 3 documents at a time for LSH operations
    },
    delayBetweenBatches: 50  // 50ms delay between batches for mobile performance
  }
};
