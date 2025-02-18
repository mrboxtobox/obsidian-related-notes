# LLM Context for Obsidian Related Notes Plugin

## Project Overview
This is a production-ready Obsidian plugin that suggests related notes using NLP and hybrid similarity analysis. The plugin is at version 1.0.0 and uses a combination of BM25 and MinHash LSH for efficient local processing.

## Key Files
- `main.ts` - Core plugin functionality
- `settings.ts` - Settings management
- `ui.ts` - UI components for related notes view
- `embeddings/` - Embedding providers implementation
  - `types.ts` - Embedding interfaces
  - `manager.ts` - Provider management
  - `bm25.ts` - BM25 implementation
  - `hybrid.ts` - Hybrid BM25 + MinHash LSH implementation
- `styles.css` - Plugin styling
- `manifest.json` - Plugin metadata
- `package.json` - Project configuration and dependencies

## Current State
- Version: 1.0.0
- Status: Production-ready
- Minimum Obsidian Version: 0.15.0

## Dependencies
### Production
No production dependencies - using built-in Obsidian APIs and local implementations

### Development
- TypeScript 4.4.4
- esbuild 0.19.12
- Various type definitions and development utilities

## Build Process
The project uses esbuild for bundling and includes:
- Development build with hot-reload (`npm run dev`)
- Production build (`npm run build`)
- Version management script (`npm run version`)

## Future Development Guidelines
1. **Version Updates**
   - Use `npm run version` to update version numbers
   - This updates both manifest.json and versions.json
   - Commit changes after version bump

2. **Dependency Management**
   - Keep dependencies minimal - focus on local implementations
   - Consider Obsidian API compatibility when updating

3. **Testing Areas**
   - NLP functionality with various note contents
   - Cache performance with large vaults
   - UI responsiveness
   - Settings persistence
   - MinHash LSH effectiveness

4. **Production Checklist**
   - [x] Version numbers synchronized
   - [x] Dependencies up to date
   - [x] Build process configured
   - [x] Documentation complete
   - [x] License included
   - [x] Manifest configured

## Outstanding Tasks
1. Monitor hybrid embedding effectiveness:
   - Compare BM25-only vs hybrid approach
   - Collect user feedback on suggestion quality
   - Evaluate MinHash parameter tuning
   - Analyze LSH band configuration impact on performance

2. Potential Improvements from MiniSearch Design:
   - Enhanced BM25 scoring for similarity:
     - Implement field-length normalization by comparing against average field length
     - Add non-linear term frequency scoring to better capture document relationships
     - Consider field-specific weights (e.g., title might be more important than body)
   - Memory optimization strategies:
     - Use numeric IDs for document references in similarity calculations
     - Optimize term dictionary storage for large vaults
   - Document relationship improvements:
     - Consider document length in similarity calculations (shorter documents might need different thresholds)
     - Implement adaptive scoring based on document characteristics
     - Support field-specific similarity weights

## Notes for LLMs
1. Always check version numbers in both manifest.json and package.json when making updates
2. The plugin uses modern ES modules - maintain this pattern
3. UI components should follow Obsidian's design patterns
4. Cache implementation is critical for performance
5. Consider mobile compatibility (plugin is not desktop-only)
6. Custom NLP Implementation:
   - Three-stage hybrid retrieval approach:
     1. LSH (Locality-Sensitive Hashing) for fast candidate retrieval
     2. MinHash for efficient similarity estimation
     3. BM25 for term-frequency based scoring
   - No external NLP dependencies - all algorithms implemented in-house
   - Document vectors stored using Obsidian's data API for persistence
   - Configurable parameters for fine-tuning:
     - numHashes: Number of hash functions for MinHash (default: 100)
     - numBands: Number of bands for LSH (default: 20)
     - k1: BM25 term frequency saturation parameter (default: 1.5)
     - b: BM25 document length normalization (default: 0.75)

7. Recent Changes:
   - Renamed FastText provider to Hybrid provider for clarity
   - Improved naming of similarity-related components
   - Enhanced similarity calculation with combined Jaccard and BM25 scores
   - Improved efficiency with LSH-based candidate retrieval
   - Added proper TypeScript type safety and error handling

8. MiniSearch Design Insights:
   - Relevant goals alignment:
     - Small memory footprint for local processing
     - Efficient document processing
     - Simple, extensible API design
   - Scoring insights:
     - Non-linear term frequency impact
     - Document length normalization
     - Field-specific weighting strategies
   - Memory-computation tradeoffs:
     - Balance between processing speed and memory usage
     - Efficient storage of document relationships
     - Optimizations for large document collections
   - Attribution: BM25 scoring insights inspired by MiniSearch (https://github.com/lucaong/minisearch)
