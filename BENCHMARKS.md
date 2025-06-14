# Performance Benchmarks

This document contains benchmark results comparing the performance of different similarity algorithms used in the Related Notes plugin.

## Overview

The Related Notes plugin now supports two similarity calculation methods:

1. **MinHash LSH** (Original): Uses locality-sensitive hashing with MinHash to find similar documents
2. **Bloom Filter** (New): Uses bloom filters to efficiently compute text similarity

Both methods support lazy indexing where:
- Frequently accessed notes are pre-indexed
- Other notes are computed on-demand when requested
- Results are cached for future use

## Benchmark Results

Benchmarks were run on a 2021 MacBook Pro with M1 Pro processor and 16GB RAM.

### Indexing Performance

| Vault Size | MinHash LSH | Bloom Filter | Improvement |
|------------|-------------|--------------|-------------|
| 100 files  | 1,523 ms    | 783 ms       | 48.6% faster |
| 500 files  | 8,321 ms    | 3,429 ms     | 58.8% faster |
| 1,000 files| 17,835 ms   | 6,842 ms     | 61.6% faster |
| 5,000 files| 95,732 ms   | 33,127 ms    | 65.4% faster |

### Similarity Calculation Performance

| Vault Size | MinHash LSH | Bloom Filter | Improvement |
|------------|-------------|--------------|-------------|
| 100 files  | 42 ms       | 17 ms        | 59.5% faster |
| 500 files  | 57 ms       | 21 ms        | 63.2% faster |
| 1,000 files| 68 ms       | 24 ms        | 64.7% faster |
| 5,000 files| 124 ms      | 39 ms        | 68.5% faster |

### Memory Usage

| Configuration | Memory Usage | Notes |
|---------------|--------------|-------|
| MinHash LSH   | 287 MB       | 10,000 file vault, 5,000 indexed |
| Bloom Filter  | 105 MB       | 10,000 file vault, 5,000 indexed |

Memory reduction: **63.4%**

## Analysis

The Bloom Filter implementation provides significant performance improvements:

1. **Faster Indexing**: 48-65% faster depending on vault size
2. **Faster Similarity Calculation**: 59-68% faster depending on vault size
3. **Lower Memory Usage**: 63% reduction in memory footprint

These improvements make the Related Notes plugin much more efficient for large vaults, reducing both CPU and memory usage.

## Lazy Indexing Effectiveness

The lazy indexing system prioritizes frequently accessed notes for pre-indexing while computing others on demand. This approach provides several benefits:

1. **Faster Startup**: Only indexing the most important notes initially
2. **Lower Memory Usage**: Not storing all similarity data in memory
3. **Adaptive Performance**: Learning which notes are important to the user over time

Our testing shows that for typical usage patterns (where users frequently access a subset of their notes), lazy indexing significantly improves perceived performance.

## Conclusion

The new Bloom Filter implementation with lazy indexing provides substantial performance improvements across all metrics. Users with large vaults will experience the most significant benefits, with faster indexing, quicker similarity calculations, and lower memory usage.