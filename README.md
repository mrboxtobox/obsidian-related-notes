# Related Notes Plugin for Obsidian

Uncover connections between notes in your vault using this plugin.

## Features

- 🔍 Automatically analyzes note content using proven similarity algorithms
- 📊 MinHash LSH + BM25 (Best Matching 25) for fast term-frequency based matching
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
3. You can also use the command palette and search for "Toggle related notes"

## Configuration

The plugin features a streamlined settings interface with both basic and advanced options:

### Basic Settings
- **Maximum Suggestions**: Control how many related notes are displayed (1-20)

### Advanced Settings
Toggle advanced settings to access detailed configuration options:

- **Similarity Provider**: Automatically switches between BM25 and MinHash LSH based on vault size (>10,000 notes), but can be manually overridden
- **Debug Mode**: Enable detailed logging for troubleshooting
- **Similarity Threshold**: Fine-tune the minimum similarity score (0-1)
- **Processing Settings**: Configure batch sizes and delays
- **Algorithm Parameters**: Detailed settings for BM25 and MinHash LSH

### Similarity Providers

The plugin automatically selects the optimal similarity provider based on your vault size:

#### BM25 (For Small-Medium Vaults)
- Local processing, no data leaves your device
- Fast and privacy-focused
- Works well for keyword-based similarity
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

### File Type Support

The plugin currently processes Markdown (.md) files only, as these are the primary content files in Obsidian. Other file types are automatically skipped to optimize performance and maintain focus on note relationships.

### Caching System

The plugin uses an intelligent caching system to improve performance:
- Document signatures and BM25 vectors are cached in memory
- LSH index structures are maintained for efficient retrieval
- Cache invalidation based on file modification time
- Indexes and scores are only recomputed when content changes
- Smart cache management to prevent unnecessary recomputation

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
- `logger.ts` - Logging utility
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
