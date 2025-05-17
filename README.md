# Related Notes Plugin for Obsidian

Uncover connections between notes in your vault using this plugin.

![Preview of the Related Notes plugin on the right pane](<screenshot.png>)

![alt text](<settings_screenshot.png>)

![alt text](<non_readme_screenshot.png>)

## Features

- 🔍 Automatically analyzes note content using proven similarity algorithms
- 🔗 One-click linking between related notes
- ⚡ Fully local processing with complete data privacy

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

#### Optimized MinHash LSH (For Large Vaults)
- Automatically selected for vaults with 10,000+ notes
- Breakthrough performance with optimized implementation:
  1. Row-based minhash calculation (10-100x faster than traditional approaches)
  2. Word-level shingles for more meaningful semantic matches
  3. Efficient Uint32Array storage for minimal memory footprint
  4. Optimized hash functions using universal hashing (a*x + b) mod p
- Scales to 50,000+ notes with minimal performance impact
- No external dependencies or setup required
- Built-in test suite and benchmarks validate both accuracy and performance

### Progressive Indexing for Complete Coverage

The plugin uses a progressive indexing approach to ensure all your notes are eventually included in the similarity index, even with very large vaults:

- **Initial Priority-Based Indexing**: At startup, the plugin prioritizes notes to pre-index based on:
  - **Access Frequency**: Notes you open frequently are prioritized
  - **Modification Time**: Recently modified notes are given higher priority
  - **Configurable Limit**: Up to 10,000 notes are pre-indexed for optimal startup performance

- **On-Demand Indexing**: Any note that isn't initially indexed gets processed when:
  - **You Open It**: The current note is always indexed immediately if needed
  - **It's Similar**: When searching for related notes, candidates are indexed on-demand
  - **Background Expansion**: The plugin gradually indexes more notes over time

- **Complete Coverage Guarantee**: Unlike sampling approaches that may miss files, this ensures:
  - **Every Accessed Note**: Gets fully indexed when you interact with it
  - **Related Content**: Notes similar to your accessed notes get discovered and indexed
  - **Incremental Expansion**: The index grows more comprehensive as you use Obsidian

- **Smart Resource Management**: Keeps memory usage reasonable while ensuring all important notes are indexed:
  - **Prioritization**: Most relevant notes are always indexed first
  - **Efficient Storage**: Uses typed arrays and sparse data structures
  - **Adaptive Parameters**: Adjusts algorithm parameters based on vault size

This progressive approach ensures you get relevant suggestions for your entire vault while maintaining excellent performance, even with tens of thousands of notes.

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
- `npm run test` - Runs tests for algorithm verification
- `npm run bench` - Runs performance benchmarks
- `npm run lint` - Checks code for style and potential issues
- `npm run typecheck` - Validates TypeScript types

### Project Structure

- `main.ts` - Main plugin file with core functionality and event handling
- `core.ts` - Core similarity algorithms and providers
- `minhash.ts` - Optimized MinHash-LSH implementation for large document collections
- `simhash.ts` - SimHash implementation for efficient document similarity
- `similarity.ts` - Similarity provider interfaces and implementations
- `settings.ts` - Settings tab implementation
- `ui.ts` - UI components and view implementations
- `tests/` - Test suites for verifying algorithm correctness
- `benchmarks/` - Performance benchmarks for similarity algorithms
- `styles.css` - Custom CSS styles
- `manifest.json` - Plugin manifest
- `package.json` - Project configuration and dependencies

### Testing with Large Vaults

For stress testing with large vaults, we've included a script to generate a test vault with 100,000 notes:

```bash
# Run the generation script (requires Python 3.6+)
./generate-test-vault.sh
```

This creates a test vault using content from Project Gutenberg texts. The test vault is stored using Git LFS and is not cloned by default to keep repository size manageable.

### Key Dependencies

- `obsidian` - Obsidian API types and utilities

## How It Works: Technical Details

The Related Notes plugin uses several sophisticated algorithms to efficiently find connections between your notes. Here's a technical overview of how the plugin works internally:

### SimHash Implementation

SimHash is a locality-sensitive hashing algorithm that converts documents into fixed-length fingerprints (hashes) where similar documents have similar hashes. The implementation follows these steps:

1. **Tokenization and Shingling**: The document text is split into overlapping sequences of words (shingles).
   ```typescript
   // Create shingles from the document text
   const words = text.toLowerCase().split(/\s+/).filter(w => w.length > 0);
   const shingles = new Map<string, number>();
   for (let i = 0; i <= words.length - config.shingleSize; i++) {
     const shingle = words.slice(i, i + config.shingleSize).join(' ');
     shingles.set(shingle, (shingles.get(shingle) || 0) + 1);
   }
   ```

2. **Feature Vector Creation**: Each shingle is hashed and contributes to a feature vector.
   ```typescript
   // Initialize feature vector
   const V = new Int32Array(config.hashBits).fill(0);
   
   // Update the vector for each shingle
   for (const [shingle, weight] of shingles.entries()) {
     const hash = hashString(shingle);
     for (let i = 0; i < config.hashBits; i++) {
       const bit = (hash & (1 << (i % 32))) !== 0;
       V[i] += bit ? weight : -weight;
     }
   }
   ```

3. **Fingerprint Generation**: The feature vector is converted to a fingerprint.
   ```typescript
   // Generate final fingerprint
   let fingerprint = BigInt(0);
   for (let i = 0; i < config.hashBits; i++) {
     if (V[i] > 0) {
       fingerprint |= BigInt(1) << BigInt(i);
     }
   }
   ```

4. **Similarity Calculation**: Hamming distance between fingerprints determines similarity.
   ```typescript
   // Calculate Hamming distance
   function hammingDistance(a: bigint, b: bigint): number {
     let xor = a ^ b;
     let distance = 0;
     while (xor > BigInt(0)) {
       if (xor & BigInt(1)) distance++;
       xor >>= BigInt(1);
     }
     return distance;
   }
   ```

5. **Optimized Retrieval**: For efficient similarity search, SimHash uses chunk-based indexing.
   ```typescript
   // Split hash into chunks for indexing
   const chunks = splitHashIntoChunks(hash, config.chunkCount, bitsPerChunk);
   
   // Index each chunk
   for (let i = 0; i < chunks.length; i++) {
     const chunkValue = chunks[i];
     const chunkBuckets = this.chunkIndex.get(i)!;
     if (!chunkBuckets.has(chunkValue)) {
       chunkBuckets.set(chunkValue, new Set<string>());
     }
     chunkBuckets.get(chunkValue)!.add(filePath);
   }
   ```

### MinHash-LSH Implementation

MinHash with Locality-Sensitive Hashing combines two techniques for efficiently finding similar documents in large collections:

1. **MinHash Signatures**: Each document is represented by a signature of minimum hash values.
   ```typescript
   // Compute signature for a set of shingles
   private computeSignature(shingles: Set<string>): Uint32Array {
     const signature = new Uint32Array(numHashes).fill(0xFFFFFFFF);
     
     for (const shingle of shingles) {
       const shingleHash = hashString(shingle);
       for (let i = 0; i < numHashes; i++) {
         const [a, b] = this.hashCoefficients[i];
         const hashValue = (a * shingleHash + b) % numBuckets;
         signature[i] = Math.min(signature[i], hashValue);
       }
     }
     
     return signature;
   }
   ```

2. **LSH Bucketing**: Signatures are split into bands to group similar documents.
   ```typescript
   // Compute LSH buckets for a document's signature
   private computeLSHBuckets(signature: Uint32Array): Map<number, number> {
     const buckets = new Map<number, number>();
     
     for (let bandIdx = 0; bandIdx < numBands; bandIdx++) {
       const startIdx = bandIdx * rowsPerBand;
       const endIdx = startIdx + rowsPerBand;
       
       let bandHash = 1;
       for (let i = startIdx; i < endIdx; i++) {
         bandHash = (bandHash * 31 + signature[i]) % numBuckets;
       }
       
       buckets.set(bandIdx, bandHash);
     }
     
     return buckets;
   }
   ```

3. **Similarity Calculation**: The Jaccard similarity between documents is estimated.
   ```typescript
   // Calculate similarity between two MinHash signatures
   private calculateSignatureSimilarity(sig1: Uint32Array, sig2: Uint32Array): number {
     let matches = 0;
     for (let i = 0; i < sig1.length; i++) {
       if (sig1[i] === sig2[i]) {
         matches++;
       }
     }
     return matches / sig1.length;
   }
   ```

### Smart Adaptation for Performance

The plugin automatically selects the appropriate algorithm based on vault size:

```typescript
// Create the appropriate similarity provider based on corpus size
export function createSimilarityProvider(vault: Vault, config: any = {}): SimilarityProvider {
  const files = vault.getMarkdownFiles();
  
  // Use SimHash for very large corpora
  if (files.length > 10000) {
    return new SimHashProvider(vault, {...});
  }
  
  // Use MinHash-LSH for medium to large corpora
  if (files.length > 1000) {
    return new MinHashLSH(vault, {...});
  }
  
  // Default to MinHash with fewer hashes for smaller corpora
  return new MinHashLSH(vault, {...});
}
```

### Performance Considerations

The implementation includes several optimizations for single-threaded environments:

1. **Batch Processing**: Files are processed in small batches with yield operations.
   ```typescript
   const BATCH_SIZE = 5;
   for (let i = 0; i < files.length; i += BATCH_SIZE) {
     const batch = files.slice(i, i + BATCH_SIZE);
     await Promise.all(batch.map(file => this.addDocument(file)));
     await this.yieldToMain(); // Yield to prevent UI blocking
   }
   ```

2. **TypedArrays**: Using Uint32Array for efficient memory usage.
   ```typescript
   const signature = new Uint32Array(numHashes);
   ```

3. **Caching**: Results are cached to avoid redundant computation.
   ```typescript
   // Check cache first
   let similarity: number;
   if (this.similarityCache.has(cacheKey)) {
     similarity = this.similarityCache.get(cacheKey)!;
   } else {
     // Calculate and cache the result
     similarity = this.calculateSignatureSimilarity(sig1, sig2);
     this.similarityCache.set(cacheKey, similarity);
   }
   ```

4. **Partial Indexing**: For very large vaults, only a subset of files is pre-indexed.
   ```typescript
   // Apply limit if configured
   if (this.config.maxFiles && files.length > this.config.maxFiles) {
     files = files.slice(0, this.config.maxFiles);
   }
   ```

## Building From Source

1. Clone the repository as described in the Development section
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. Copy the following files to your Obsidian plugins folder:
   - main.js
   - manifest.json
   - styles.css

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Optimization Summary

The plugin has been optimized with the following principles in mind:

### Performance Optimizations
- **Efficient Hashing**: Uses FNV-1a algorithm with 4-character batching for faster computation
- **Adaptive Shingling**: Adjusts shingle size and processing for large documents
- **Memory Management**: Limits maximum shingles for large documents to control memory usage
- **UI Responsiveness**: Throttles UI updates and uses batched processing with yield operations
- **TypedArrays**: Utilizes Uint32Array for efficient memory usage

### Efficiency for Single-Threaded Environments
- **Non-Blocking Operations**: All long-running operations yield to the main thread periodically
- **Batch Processing**: Files and document components are processed in small batches
- **Throttled Updates**: UI updates are throttled to prevent excessive reflows
- **Adaptive Processing**: More aggressive sampling for larger documents
- **Early Termination**: Calculations stop early when appropriate thresholds are reached

### Algorithm Selection
- **Dynamic Provider Selection**: Automatically selects SimHash for very large vaults
- **Parameter Tuning**: Adjusts hash bits, chunk count, and shingle size based on vault size
- **Chunked Indexing**: Optimizes SimHash with chunk-based indexing for faster queries
- **Frequency-Based Filtering**: Prioritizes important shingles in large documents

### Documentation
- Added detailed technical documentation explaining how the algorithms work
- Included code examples for critical sections of the implementation
- Documented performance considerations for single-threaded environments

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
