# Related Notes Plugin Development Notes

## Load Time Optimization

The plugin has been optimized for faster load times by implementing the following strategies:

1. **Deferred Initialization**
   - Heavy initialization moved to `onLayoutReady` callback
   - Only essential components registered during initial `onload`
   - View registration deferred until after app layout is ready

2. **Initialization Order**
   ```mermaid
   graph TD
      A[Plugin onload] --> B[Register Commands]
      A --> C[Create Status Bar]
      C --> D[onLayoutReady]
      D --> E[Initialize UI]
      D --> F[Register Event Handlers]
      D --> G[Initialize Similarity Provider]
   ```

3. **Performance Considerations**
   - Status bar provides immediate feedback during initialization
   - View creation deferred until needed
   - Heavy computation happens after app is interactive

## Smart Caching Implementation

The plugin now implements smart caching to improve performance and reduce token usage:

1. **Cache Persistence**
   - Similarity data is cached to disk between sessions
   - Cache includes file vectors, signatures, related notes, and file metadata
   - Version tracking ensures cache compatibility across plugin updates

2. **Incremental Updates**
   ```mermaid
   graph TD
      A[Load Cache] -->|Success| B[Check for Changes]
      A -->|Failure| C[Full Reindexing]
      B -->|No Changes| D[Use Cache As-Is]
      B -->|Changes Detected| E[Incremental Update]
      E --> F[Update Changed Files]
      F --> G[Recalculate Relationships]
      G --> H[Save Updated Cache]
   ```

3. **Drift Tolerance**
   - Allows approximate results with configurable drift threshold (10%)
   - Only forces reindexing when changes exceed threshold
   - Periodic updates ensure cache freshness (every 5 minutes)

4. **Token Optimization**
   - Uses Jaccard similarity for cached vectors to reduce computation
   - Falls back to cosine similarity only when necessary
   - Efficient data structures minimize memory usage

## Development Guidelines

When making changes to the plugin:

1. Keep the `onload` function lightweight
   - Only register essential components
   - Use `onLayoutReady` for heavy initialization
   - Avoid synchronous operations that could block app startup

2. View Management
   - Views should be registered after layout is ready
   - Keep view constructors lightweight
   - Defer expensive operations in views until they're actually needed

3. Similarity Provider
   - Initialization is deferred until after app startup
   - Progress updates through status bar
   - Sampling large note collections for better performance
   - Smart caching reduces repeated computations

## Best Practices

1. **Production Build**
   - Always use production builds for releases
   - Enable minification in build configuration
   - Remove development/testing code

2. **Startup Performance**
   - Minimize synchronous operations in `onload`
   - Use `onLayoutReady` for non-critical initialization
   - Leverage caching for expensive operations

3. **View Performance**
   - Keep view constructors minimal
   - Load data only when views become visible
   - Clean up resources when views are closed

## Adaptive Similarity for Large Corpora

The plugin now implements adaptive similarity detection for large note collections:

1. **Dynamic LSH Parameters**
   ```mermaid
   graph TD
      A[Check Corpus Size] -->|Large Corpus| B[Use More Lenient Parameters]
      A -->|Small Corpus| C[Use Standard Parameters]
      B --> D[More Bands, Fewer Rows per Band]
      C --> E[Standard Bands and Rows]
      D --> F[Find More Candidate Pairs]
      E --> G[Find High-Quality Matches Only]
   ```

2. **Similarity Boosting**
   - Lower similarity threshold for large corpora (0.15 vs 0.3)
   - Similarity scores are boosted by 20% for large corpora
   - Ensures approximate matches are included in results
   - Maintains high-quality matches for smaller collections

3. **Adaptive Configuration**
   - Large corpus threshold set at 1000 notes
   - More bands (8 vs 5) for large corpora to find more candidates
   - Fewer rows per band (1 vs 2) for more lenient matching
   - Automatically adjusts based on corpus size

## Code Cleanup

1. **Removed Unused Properties**
   - Removed unused `cacheLoaded` property from SimilarityProviderV2 class
   - The property was redundant since the `loadFromCache` method already returns a boolean indicating cache load status

## UI Improvements

1. **Simplified Related Notes View**
   - Removed all similarity indicators for a cleaner interface
   - Focused on presenting just the note names without distractions
   - Created a minimalist design that prioritizes content over metadata
   - Improved visual clarity by eliminating visual noise
   - Enhanced the user experience with a streamlined presentation

2. **Improved Status Bar Progress Indicator**
   - Simplified progress reporting with clean text-based format
   - Maintained phase-based messaging ("Reading notes", "Analyzing patterns", etc.)
   - Progress now flows from 0% to 100% with fine-grained 1% increments
   - Eliminated large 25% jumps between phases for a smoother experience
   - Kept the familiar ellipses format for consistency with Obsidian's style

3. **Visual Components in Related Notes View**
   ```mermaid
   graph TD
      A[Related Note Item] --> B[Link Container]
      B --> C[Note Name]
   ```

4. **Status Bar Progress Components**
   ```mermaid
   graph LR
      A[Status Bar Item] --> B[Phase Text]
      B --> C[Ellipses]
      A --> D[Percentage]
   ```

5. **Accessibility Considerations**
   - Created a clean, distraction-free interface focused on content
   - Removed visual complexity for improved readability
   - Simplified the UI to reduce cognitive load
   - Focused on essential information only
   - Enhanced usability through minimalist design principles

6. **Consistent UI Styling**
   - Standardized font sizes across all UI elements to 14px for better readability
   - Ensured all text is consistently left-aligned for a more natural reading experience
   - Increased padding in content areas for better visual spacing
   - Improved list item spacing and padding for better visual hierarchy
   - Added consistent styling for info messages
   - Adjusted title font size to match the content for visual harmony
   - Enhanced the overall visual consistency of the interface
   ```mermaid
   graph TD
      A[UI Consistency] --> B[Standardized Font Sizes]
      A --> C[Left-Aligned Text]
      A --> D[Consistent Padding]
      A --> E[Improved Spacing]
      A --> F[Unified Message Styling]
   ```

## Bug Fixes

1. **Fixed TypeError in hashBand Method**
   - Fixed an error where `Cannot read properties of undefined (reading 'join')` was occurring in the `SimilarityProviderV2.hashBand` method
   - The issue was in the `findCandidatePairsForFile` method where it tried to access `otherBands[bandIdx]` without checking if that index exists
   - Added a check to ensure the band exists before trying to hash it, preventing the error when signatures have different lengths
   - This improves stability when comparing notes with varying signature lengths

## Future Considerations

1. Consider implementing:
   - User-configurable similarity thresholds
   - Configuration options for cache behavior
   - User-adjustable drift threshold
   - Worker thread for background processing
   - Progressive loading of related notes
   - UI indicator for approximate matches
   - Custom CSS classes instead of inline styles for better theme compatibility
   - Accessibility settings for color blind users

2. Monitor:
   - Cache hit/miss rates
   - Memory usage during initialization
   - Time spent in each initialization phase
   - Impact on Obsidian startup time
   - Quality of approximate matches
   - User feedback on the new similarity visualization
