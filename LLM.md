# Obsidian Related Notes Plugin - Technical Overview

## Project Summary

The Obsidian Related Notes plugin is designed to discover and display notes that are semantically related to the currently active note in an Obsidian vault. It uses a sophisticated but efficient similarity detection algorithm based on Bloom filters to identify connections between notes that might not be explicitly linked.

## Core Functionality

### How It Works

1. **Indexing**: The plugin indexes all markdown files in the vault by:
   - Tokenizing the text content (handling multiple languages, code blocks, URLs)
   - Creating Bloom filters of these tokens for each document
   - Storing these filters in memory and persisting them to a cache file

2. **Similarity Detection**: When a note is active, the plugin:
   - Retrieves the Bloom filter for the active note
   - Compares it with Bloom filters of other notes using Jaccard similarity
   - Ranks and displays the most similar notes in a sidebar

3. **User Interface**: The plugin provides:
   - A sidebar view showing related notes
   - One-click linking between related notes
   - Settings for controlling the number of suggestions
   - Options to rebuild the index or clear the cache

## Key Components

### 1. Core Similarity Engine (`core.ts`)

- Defines interfaces for similarity providers
- Implements advanced tokenization with support for:
  - Multiple languages (including CJK scripts)
  - Code blocks and technical terms
  - Stopword filtering
  - Simple stemming for better matching

### 2. Bloom Filter Implementation (`bloom.ts`)

- Implements a memory-efficient Bloom filter data structure
- Uses multiple hash functions for better distribution
- Calculates Jaccard similarity between filters
- Handles filter saturation to prevent false positives
- Adaptively identifies common words across the vault

### 3. Multi-Resolution Bloom Filter (`multi-bloom.ts`)

- Extends the basic Bloom filter with multiple n-gram sizes
- Implements progressive indexing for large vaults
- Provides caching mechanisms for persistence
- Handles sampling for efficient similarity calculation in large vaults
- Adaptively tunes parameters based on vault characteristics

### 4. Main Plugin Logic (`main.ts`)

- Initializes the plugin and registers views
- Manages the indexing process with progress reporting
- Handles file events (create, modify, delete)
- Implements commands and UI elements
- Manages the plugin lifecycle

### 5. Settings Management (`settings.ts`)

- Defines configurable options
- Provides UI for adjusting settings
- Implements index rebuilding and cache clearing

### 6. User Interface (`ui.ts`)

- Implements the sidebar view for displaying related notes
- Handles note linking functionality
- Provides visual feedback on link status

## Technical Implementation Details

### Bloom Filter Similarity

The plugin uses Bloom filters (a probabilistic data structure) to efficiently represent document content:

1. **Document Processing**:
   - Text is tokenized and normalized
   - Common words are identified and filtered
   - Tokens are added to a Bloom filter

2. **Similarity Calculation**:
   - Jaccard similarity is calculated between Bloom filters
   - This measures the intersection over union of the sets
   - Adjustments are made for filter saturation

3. **Optimizations**:
   - Multi-resolution approach combines different n-gram sizes
   - Adaptive parameters tune the algorithm to the vault's characteristics
   - Sampling is used for large vaults to maintain performance

### Progressive Indexing

For large vaults, the plugin implements a progressive indexing strategy:

1. **Initial Indexing**:
   - Prioritizes recently modified files and currently open files
   - Indexes a subset of files to provide immediate functionality

2. **Background Indexing**:
   - Continues indexing remaining files in small batches
   - Runs during idle time to avoid impacting performance
   - Updates the UI as indexing progresses

### Caching

The plugin implements a caching system to avoid reindexing on restart:

1. **Cache Storage**:
   - Serializes Bloom filters to JSON
   - Stores in the plugin's directory

2. **Cache Invalidation**:
   - Detects parameter changes
   - Handles version updates
   - Provides manual cache clearing

## Performance Considerations

- **Memory Efficiency**: Uses compact Bloom filters instead of full vector representations
- **Adaptive Parameters**: Automatically tunes filter sizes and hash functions
- **Sampling**: For large vaults, uses statistical sampling to maintain performance
- **Progressive Indexing**: Spreads indexing load over time for better responsiveness
- **Yielding**: Frequently yields to the main thread to keep the UI responsive

## Outstanding Work

- None identified at this time. The plugin appears to be fully functional with a robust implementation.

## Future Enhancement Possibilities

1. **Enhanced Similarity Metrics**: Explore additional similarity measures beyond Jaccard
2. **Content-Based Filtering**: Add options to filter by tags, headings, or other metadata
3. **Visualization Improvements**: Add visual indicators of similarity strength
4. **Integration with Graph View**: Show related notes in the graph view with special highlighting
5. **Batch Linking**: Add functionality to link multiple related notes at once
