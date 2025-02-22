# LLM Context for Obsidian Related Notes Plugin

## Project Overview
This is a production-ready Obsidian plugin that suggests related notes using proven text similarity algorithms. The plugin uses a combination of BM25 and MinHash LSH for efficient local processing, with no external dependencies.

## Key Files
- `main.ts` - Core plugin functionality and event handling
  - Plugin initialization and lifecycle management
  - File event handling (create, modify, delete, rename)
  - Settings management
  - View registration and management
- `core.ts` - Core similarity algorithms and providers
  - RelatedNotesView implementation
  - BM25Provider implementation
  - MinHashLSHProvider implementation
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

### Similarity Algorithms
1. BM25 Provider
   - Classic BM25 algorithm for document similarity
   - Optimized for keyword-based matching
   - Fast local processing with no external dependencies
   - Ideal for small to medium-sized vaults

2. MinHash LSH + BM25 Provider
   - Three-stage hybrid retrieval approach:
     1. LSH (Locality-Sensitive Hashing) for fast candidate retrieval
     2. MinHash for efficient similarity estimation
     3. BM25 for term-frequency based scoring
   - Recommended for large vaults (>10,000 notes)
   - Sub-linear search time complexity
   - Configurable parameters:
     - numHashes: Number of hash functions for MinHash (default: 100)
     - numBands: Number of bands for LSH (default: 20)
     - k1: BM25 term frequency saturation parameter (default: 1.5)
     - b: BM25 document length normalization (default: 0.75)

### Core Components
1. Document Processing
   - Markdown-specific preprocessing
   - Title extraction and weighting
   - Link and metadata handling
   - Tokenization and normalization

2. Similarity Calculation
   - BM25 scoring for term importance
   - MinHash signatures for efficient Jaccard similarity estimation
   - LSH for sub-linear time candidate retrieval
   - Configurable similarity thresholds

3. Caching System
   - Document signatures cached in memory
   - BM25 vectors cached for fast scoring
   - LSH index structures maintained for efficient retrieval
   - Cache invalidation based on file modification time
   - Indexes and scores only recomputed when content changes
   - Smart cache management to prevent unnecessary recomputation

4. UI Components
   - Native Obsidian theme integration
   - Real-time updates

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
   - Similarity algorithm effectiveness
   - Cache performance with large vaults
   - UI responsiveness
   - Settings persistence
   - MinHash LSH scalability

4. **Production Checklist**
   - [x] Version numbers synchronized
   - [x] Dependencies up to date
   - [x] Build process configured
   - [x] Documentation complete
   - [x] License included
   - [x] Manifest configured

## Outstanding Tasks
1. Monitor similarity algorithm effectiveness:
   - Compare BM25-only vs MinHash LSH approach
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
6. All similarity algorithms are implemented in-house
7. Document vectors use Obsidian's data API for persistence

## Recent Changes
- Removed "Add Link" functionality to simplify the UI and focus on core similarity features
- Implemented two-stage similarity search for MinHash LSH provider:
  - Stage 1: Use LSH for fast candidate filtering (0.5x threshold)
  - Stage 2: Apply BM25 scoring only on filtered candidates
- Implemented automatic MinHash LSH selection for vaults with >10,000 notes
- Simplified settings UI with basic/advanced toggle:
  - Basic: Only shows maximum suggestions setting
  - Advanced: Reveals all detailed configuration options
- Updated documentation to reflect automatic algorithm selection
- Clarified BM25 and MinHash LSH implementations
- Enhanced caching system with smarter invalidation
- Improved documentation with detailed algorithm descriptions
- Enhanced error handling and logging
- Refined similarity calculation with proper index management
- Added proper TypeScript type safety

## Search Algorithm Details
The plugin now uses a more efficient two-stage search approach when using MinHash LSH:

1. Candidate Selection (LSH)
   - Uses MinHash LSH with a relaxed threshold (0.5x of final threshold)
   - Quickly filters potential candidates
   - Reduces the search space significantly
   - Helps maintain sub-linear search time

2. Precise Scoring (BM25)
   - Applied only to filtered candidates
   - Uses BM25 algorithm for accurate content similarity
   - Ensures high-quality results
   - More computationally intensive but applied to fewer documents

This approach provides:
- Better performance through reduced computation
- Maintained accuracy with BM25 scoring
- Scalability for large vaults
- Memory efficiency

## Current Settings Structure
- Basic Settings:
  - Maximum Suggestions (1-20)
- Advanced Settings (toggled):
  - Similarity Provider (auto-selected based on vault size)
  - Debug Mode
  - Similarity Threshold
  - Processing Settings
  - Algorithm Parameters (BM25 and MinHash LSH)

## Style Loading
The plugin's styles (styles.css) are automatically loaded by Obsidian's plugin system. The previous manual style loading implementation was redundant and has been removed to prevent potential issues with duplicate style loading.
