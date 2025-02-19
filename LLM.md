# LLM Context for Obsidian Related Notes Plugin

## Project Overview
This is a production-ready Obsidian plugin that suggests related notes using NLP and hybrid similarity analysis. The plugin uses a combination of BM25 and MinHash LSH for efficient local processing, with no external dependencies.

## Key Files
- `main.ts` - Core plugin functionality and event handling
  - Plugin initialization and lifecycle management
  - File event handling (create, modify, delete, rename)
  - Settings management
  - View registration and management
- `core.ts` - Core NLP functionality and embedding providers
  - RelatedNotesView implementation
  - BM25EmbeddingProvider implementation
  - HybridEmbeddingProvider implementation
  - WordTokenizer and similarity calculation utilities
- `settings.ts` - Settings management
  - Settings UI implementation
  - Configuration options handling
- `logger.ts` - Logging utility
  - Structured logging with severity levels
  - Debug mode support
  - Performance timing utilities
- `styles.css` - Plugin styling
- `manifest.json` - Plugin metadata
- `package.json` - Project configuration and dependencies

## Current State
- Status: Production-ready
- Minimum Obsidian Version: 0.15.0
- File Support: Markdown (.md) files only

## Dependencies
### Production
- No external production dependencies - using built-in Obsidian APIs and local implementations

### Development
- TypeScript
- esbuild
- Obsidian API types

## Build Process
The project uses esbuild for bundling and includes:
- Development build with hot-reload (`npm run dev`)
- Production build (`npm run build`)
- Version management script (`npm run version`)

## Implementation Details

### NLP Implementation
1. BM25 Provider
   - Classic BM25 algorithm for document similarity
   - Optimized for keyword-based matching
   - Fast local processing with no external dependencies

2. Hybrid Provider (BM25 + MinHash LSH)
   - Three-stage hybrid retrieval approach:
     1. LSH (Locality-Sensitive Hashing) for fast candidate retrieval
     2. MinHash for efficient similarity estimation
     3. BM25 for term-frequency based scoring
   - Configurable parameters:
     - numHashes: Number of hash functions for MinHash (default: 100)
     - numBands: Number of bands for LSH (default: 20)
     - k1: BM25 term frequency saturation parameter (default: 1.5)
     - b: BM25 document length normalization (default: 0.75)
     - titleWeight: Weight for title matches (default: 2.0)
     - fuzzyDistance: Levenshtein distance for fuzzy matching (default: 1)

### Core Components
1. Document Processing
   - Markdown-specific preprocessing
   - Title extraction and weighting
   - Link and metadata handling
   - Tokenization and normalization

2. Similarity Calculation
   - Combined Jaccard and BM25 similarity scores
   - Efficient vector operations
   - Configurable similarity thresholds

3. Caching System
   - In-memory vector caching
   - File modification tracking
   - Smart cache invalidation

4. UI Components
   - Native Obsidian theme integration
   - Real-time updates
   - Interactive link management

## Future Development Guidelines
1. **Version Updates**
   - Use `npm run version` to update version numbers
   - This updates both manifest.json and versions.json
   - Commit changes after version bump

2. **Dependency Management**
   - Keep dependencies minimal
   - Focus on local implementations
   - Consider Obsidian API compatibility

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
   - Analyze LSH band configuration impact

2. Potential Improvements:
   - Enhanced BM25 scoring:
     - Field-length normalization improvements
     - Non-linear term frequency scoring
     - Field-specific weights optimization
   - Memory optimization:
     - Numeric ID system for document references
     - Term dictionary storage optimization
   - Document relationship improvements:
     - Adaptive scoring based on document characteristics
     - Support for field-specific similarity weights

## Notes for LLMs
1. Always check version numbers in both manifest.json and package.json
2. The plugin uses modern ES modules
3. UI components follow Obsidian's design patterns
4. Cache implementation is critical for performance
5. Consider mobile compatibility
6. All NLP algorithms are implemented in-house
7. Document vectors use Obsidian's data API for persistence

## Recent Changes
- Removed manual styles loading (`loadStyles()` method) since Obsidian automatically loads plugin CSS files
- Improved documentation with detailed JSDoc comments
- Enhanced error handling and logging
- Refined similarity calculation with combined metrics
- Improved efficiency with LSH-based retrieval
- Added proper TypeScript type safety

## Style Loading
The plugin's styles (styles.css) are automatically loaded by Obsidian's plugin system. The previous manual style loading implementation was redundant and has been removed to prevent potential issues with duplicate style loading.
