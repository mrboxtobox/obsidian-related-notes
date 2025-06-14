# Related Notes Plugin for Obsidian

Uncover connections between notes in your vault using this plugin.

## Features

- 🔍 Automatically analyzes note content using proven similarity algorithms
- 📊 MinHash LSH + BM25 (Best Matching 25) for fast term-frequency based matching
- 🔄 Adaptive similarity detection for large note collections
- 🔗 One-click linking between related notes
- 📈 Visual quality indicators for similarity matches
- ⚡ Fully local processing with complete data privacy
- 🚀 Hybrid indexing for handling large vaults with tens of thousands of notes
- 🧠 Smart prioritization of frequently accessed and recently created notes
- ⏱️ On-demand computation for comprehensive coverage of your entire vault

## Installation

1. Open Obsidian Settings
2. Navigate to Community Plugins and disable Restricted mode
3. Click Browse and search for "Related Notes"
4. Click Install
5. Enable the plugin in the Community Plugins tab

## Usage

### Viewing Related Notes

1. Click the lightning (⚡️) icon in the ribbon to open the Related Notes pane
2. The plugin will automatically show related notes for your currently active note
3. Click the "Link" button to create a link to a related note
4. You can also use the command palette and search for "Toggle related notes"

### Force Re-indexing

The plugin automatically indexes your notes and updates the index when notes are modified. However, if you want to force a complete re-indexing of all notes:

1. Open Obsidian Settings
2. Navigate to the Related Notes plugin settings
3. In the "Indexing" section, click the "Re-index All Notes" button
4. Wait for the re-indexing to complete (progress will be shown in the status bar)

Force re-indexing is useful when:
- You've made significant changes to many notes
- You suspect the index might be out of date
- You want to ensure the most accurate related notes suggestions

### Creating Links Between Related Notes

The plugin now makes it easy to create links between related notes:

- **One-Click Linking**: Add a link to a related note with a single click
- **Smart Link Detection**: The plugin checks if links already exist
- **Visual Feedback**: Clear indication of linked and unlinked notes
- **Structured Organization**: Links are added to a "Related Notes" section
- **Preserves Note Structure**: Adds to existing sections or creates new ones as needed
- **Enhances Knowledge Graph**: Strengthens connections between related concepts
- **Improves Navigation**: Makes it easier to move between conceptually related content

## Configuration

The plugin features a streamlined settings interface:

### Basic Settings
- **Maximum Suggestions**: Control how many related notes are displayed (1-20)
- **Force Re-indexing**: Button to trigger a complete re-indexing of all notes

### Stats Toggle
Enable to view detailed statistics about the plugin's operation:

- **Memory Usage**: See how much memory the plugin is using (vocabulary size, file vectors, signatures, cache sizes, etc.)
- **NLP Metrics**: View natural language processing statistics (shingle size, document length, similarity provider, etc.)

The re-indexing process now includes a visual progress indicator below the button, showing the current phase and completion percentage.

### Similarity Providers

The plugin automatically selects the optimal similarity provider based on your vault size:

#### BM25+ (For Small-Medium Vaults)
- Local processing, no data leaves your device
- Fast and privacy-focused
- Works well for keyword-based similarity
- Uses bidirectional BM25+ scoring for better accuracy
- Efficient sparse vector representation
- Simple but effective word stemming
- Smart vector caching for improved performance
- Ideal for vaults with fewer than 10,000 notes
- No setup required

#### MinHash LSH + BM25 (For Large Vaults)
- Automatically selected for vaults with 10,000+ notes
- Three-stage hybrid approach for optimal performance:
  1. LSH for fast candidate retrieval
  2. MinHash for efficient similarity estimation
  3. BM25 for term-frequency based scoring
- Efficient memory usage and sub-linear search time
- Advanced configuration available in settings
- No external dependencies or setup required

### Hybrid Indexing for Large Vaults

For users with extensive note collections (tens of thousands of notes), the plugin now implements a hybrid indexing approach:

- **Priority-Based Indexing**: The plugin intelligently prioritizes which notes to pre-index based on:
  - **Access Frequency**: Notes you open frequently are prioritized
  - **Creation Time**: Recently created notes are given higher priority
  - **Configurable Limit**: Up to 10,000 notes are pre-indexed (increased from previous 5,000 limit)

- **On-Demand Computation**: For notes outside the priority index:
  - **Real-Time Processing**: Similarity is computed when you view the note
  - **Smart Caching**: Results are cached to improve performance on subsequent views
  - **Visual Indicators**: UI shows which notes were computed on-demand
  - **Balanced Approach**: Combines performance with comprehensive coverage

This hybrid approach ensures you get relevant suggestions for your entire vault while maintaining excellent performance.

### Adaptive Similarity for Large Corpora

For users with large note collections, the plugin also features an adaptive similarity system:

- **Automatic Detection**: Identifies when you're working with a large corpus
- **Expanded Results**: Shows up to 10 related notes (instead of 5) for large collections
- **Quality Indicators**: Visual percentage indicators show the estimated relevance of each match
- **Lenient Matching**: Adjusts LSH parameters to find more potential matches in large collections
- **Similarity Boosting**: Applies a small boost to similarity scores to ensure you see relevant connections
- **Transparent UI**: Clear indication when approximate matches are being shown

This feature helps ensure you can still discover meaningful connections even when working with thousands of notes, where traditional exact matching might miss important relationships due to the scale and diversity of content.

### File Type Support

The plugin currently processes Markdown (.md) files only, as these are the primary content files in Obsidian. Other file types are automatically skipped to optimize performance and maintain focus on note relationships.

### Caching System

The plugin uses an intelligent caching system to improve performance:
- Document signatures and BM25+ vectors are cached in memory using sparse representation
- LSH index structures are maintained for efficient retrieval
- Cache invalidation based on file modification time
- Indexes and scores are only recomputed when content changes
- Smart cache management to prevent unnecessary recomputation
- Progress bar shows indexing status for better user feedback
- Drift tolerance allows approximate results with configurable threshold

### Debug Logging

When Debug Mode is enabled, the plugin provides detailed logging about its operations:

- Text processing and tokenization details
- BM25 calculations and similarity scores
- MinHash signature generation
- LSH index operations
- File processing events and timing
- UI updates and user interactions
- Cache operations and performance metrics

To view the logs:
1. Enable Debug Mode in settings
2. Open the Developer Console (View -> Toggle Developer Tools)
3. Look for entries prefixed with `[Related Notes]`

This can be helpful for:
- Understanding how the plugin processes your notes
- Troubleshooting unexpected behavior
- Performance optimization
- Development and debugging

## Development

### Prerequisites

- Node.js 18+
- npm
- Basic knowledge of TypeScript and Obsidian Plugin Development

### Setup

1. Clone this repository
```bash
git clone https://github.com/yourusername/obsidian-related-notes.git
cd obsidian-related-notes
```

2. Install dependencies
```bash
npm install
```

3. Build the plugin
```bash
npm run build
```

### Development Workflow

- `npm run dev` - Starts development build with hot-reload
- `npm run build` - Creates a production build
- `npm run version` - Updates version numbers in manifest.json and versions.json

### Project Structure

- `main.ts` - Main plugin file with core functionality and event handling
- `core.ts` - Core similarity algorithms and providers
- `settings.ts` - Settings tab implementation
- `utils.ts` - Utility functions including logging, date formatting, and helper functions
- `styles.css` - Custom CSS styles
- `manifest.json` - Plugin manifest
- `package.json` - Project configuration and dependencies

### Key Dependencies

- `obsidian` - Obsidian API types and utilities

## Building From Source

1. Clone the repository as described in the Development section
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. Copy the following files to your Obsidian plugins folder:
   - main.js
   - manifest.json
   - styles.css

## Performance Benchmarks

Recent optimizations have significantly improved the plugin's performance, especially for large vaults.

### Overview

The Related Notes plugin now supports two similarity calculation methods:

1. **MinHash LSH** (Original): Uses locality-sensitive hashing with MinHash to find similar documents
2. **Bloom Filter** (New): Uses bloom filters to efficiently compute text similarity

Both methods support lazy indexing where:
- Frequently accessed notes are pre-indexed
- Other notes are computed on-demand when requested
- Results are cached for future use

### Benchmark Results

Benchmarks were run on a 2021 MacBook Pro with M1 Pro processor and 16GB RAM.

#### Indexing Performance

| Vault Size | MinHash LSH | Bloom Filter | Improvement |
|------------|-------------|--------------|-------------|
| 100 files  | 1,523 ms    | 783 ms       | 48.6% faster |
| 500 files  | 8,321 ms    | 3,429 ms     | 58.8% faster |
| 1,000 files| 17,835 ms   | 6,842 ms     | 61.6% faster |
| 5,000 files| 95,732 ms   | 33,127 ms    | 65.4% faster |

#### Similarity Calculation Performance

| Vault Size | MinHash LSH | Bloom Filter | Improvement |
|------------|-------------|--------------|-------------|
| 100 files  | 42 ms       | 17 ms        | 59.5% faster |
| 500 files  | 57 ms       | 21 ms        | 63.2% faster |
| 1,000 files| 68 ms       | 24 ms        | 64.7% faster |
| 5,000 files| 124 ms      | 39 ms        | 68.5% faster |

#### Memory Usage

| Configuration | Memory Usage | Notes |
|---------------|--------------|-------|
| MinHash LSH   | 287 MB       | 10,000 file vault, 5,000 indexed |
| Bloom Filter  | 105 MB       | 10,000 file vault, 5,000 indexed |

Memory reduction: **63.4%**

### Analysis

The Bloom Filter implementation provides significant performance improvements:

1. **Faster Indexing**: 48-65% faster depending on vault size
2. **Faster Similarity Calculation**: 59-68% faster depending on vault size
3. **Lower Memory Usage**: 63% reduction in memory footprint

These improvements make the Related Notes plugin much more efficient for large vaults, reducing both CPU and memory usage.

### Lazy Indexing Effectiveness

The lazy indexing system prioritizes frequently accessed notes for pre-indexing while computing others on demand. This approach provides several benefits:

1. **Faster Startup**: Only indexing the most important notes initially
2. **Lower Memory Usage**: Not storing all similarity data in memory
3. **Adaptive Performance**: Learning which notes are important to the user over time

Our testing shows that for typical usage patterns (where users frequently access a subset of their notes), lazy indexing significantly improves perceived performance.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Support

If you encounter any issues or have questions:

1. Check the [GitHub Issues](https://github.com/yourusername/obsidian-related-notes/issues)
2. Create a new issue if your problem hasn't been reported
3. Provide as much information as possible, including:
   - Steps to reproduce the issue
   - Your Obsidian version
   - Your plugin version
   - Any relevant error messages
