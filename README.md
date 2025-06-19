# Related Notes Plugin for Obsidian

[![Tests](https://github.com/yourusername/obsidian-related-notes/workflows/Run%20Tests/badge.svg)](https://github.com/yourusername/obsidian-related-notes/actions)
[![Buy Me A Coffee](https://img.shields.io/badge/buy%20me%20a%20coffee-donate-yellow.svg)](https://buymeacoffee.com/oluwasanya)

Uncover connections between notes in your vault using this plugin.

![Preview of the Related Notes plugin on the right pane](<screenshot.png>)

![alt text](<settings_screenshot.png>)

![alt text](<non_readme_screenshot.png>)

Uncover connections between notes in your vault using this plugin.

## Features

- 🔍 Automatically analyzes note content using multi-resolution Bloom filters
- 🔗 One-click linking between related notes
- ⚡ Fully local processing with complete data privacy
- 🚀 Efficient indexing for handling large vaults with tens of thousands of notes
- 💡 Multi-resolution n-gram sizes for better accuracy across different document styles

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

### Multi-Resolution Bloom Filter

The plugin uses a multi-resolution bloom filter approach for efficient similarity detection:

#### How It Works
- **Bloom Filters**: Probabilistic data structures for efficient similarity detection
- **Multiple N-gram Sizes**: Combines different character sequence lengths (2, 3, and 4-grams by default)
- **Weighted Similarity**: Different resolutions contribute differently to the final similarity score
- **Unicode Support**: Properly handles multi-byte characters in all languages
- **Adaptive Parameters**: Self-tunes based on your vault's characteristics

#### Advantages
- **Memory Efficiency**: Uses just a fraction of the memory of traditional algorithms
- **Language Agnostic**: Works equally well with English, Chinese, Japanese, Arabic, etc.
- **Automatic Stopword Detection**: Identifies common words in any language
- **Fast Similarity Calculation**: Quick Jaccard similarity computation
- **No Training Required**: Works immediately without model training
- **Privacy-Focused**: All processing happens locally on your device

### Efficient Indexing for Large Vaults

For users with extensive note collections (tens of thousands of notes), the plugin implements an efficient indexing strategy:

- **Optimized Memory Usage**: 
  - The multi-resolution bloom filter uses minimal memory per document
  - A 1000-document vault might use only ~1MB of memory total
  - Even large vaults with 50,000+ notes remain performant

- **Adaptive Parameters**:
  - Automatically detects common words in your vault to exclude from similarity calculations
  - Adjusts n-gram sizes based on your document characteristics
  - Tunes bloom filter sizes and hash functions for optimal performance
  - All adaptations happen automatically without user intervention

- **Fast Similarity Calculation**:
  - Bloom filter comparison is extremely fast (O(1) complexity)
  - Jaccard similarity provides reliable relevance ranking
  - Works equally well across all languages and writing styles

This approach ensures you get relevant suggestions for your entire vault while maintaining excellent performance.

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
- `npm run dev:test` - Starts development build with hot-reload and copies files to test-vault
- `npm run dev:custom` - Starts development build with custom target directories (set TARGET_DIRS env var)
- `npm run build` - Creates a production build
- `npm run build:test` - Creates a production build and copies files to test-vault
- `npm run build:custom` - Creates a production build with custom target directories (set TARGET_DIRS env var)
- `npm run version` - Updates version numbers in manifest.json and versions.json

### Project Structure

- `src/main.ts` - Main plugin file with core functionality and event handling
- `src/core.ts` - Core similarity algorithms and interfaces
- `src/bloom.ts` - Bloom filter implementation for efficient similarity calculation
- `src/multi-bloom.ts` - Multi-resolution bloom filter with adaptive parameters
- `src/settings.ts` - Settings tab implementation
- `src/ui.ts` - User interface components for related notes view
- `src/styles.css` - Custom CSS styles for the plugin
- `src/manifest.json` - Plugin manifest file
- `package.json` - Project configuration and dependencies
- `esbuild.config.mjs` - Build configuration for esbuild that handles copying files

### Key Dependencies

- `obsidian` - Obsidian API types and utilities

## Building From Source

1. Clone the repository
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

4. Copy the built files to your Obsidian plugins folder
```bash
# For testing with the included test-vault
npm run dev:test

# For testing with custom vault locations
TARGET_DIRS='["path/to/vault1/.obsidian/plugins/related-notes", "path/to/vault2/.obsidian/plugins/related-notes"]' npm run dev:custom
```

Alternatively, you can manually copy the following files to your Obsidian plugins folder:
- `main.js`
- `manifest.json`
- `styles.css`

Note: These files are generated from the source files in the `src/` directory.

## Release Process

This plugin follows Obsidian's guidelines for plugin releases. The following scripts are available to streamline the release process:

1. Validate your plugin against Obsidian's requirements:
```bash
npm run validate
```

2. Create a new release (patch, minor, or major version):
```bash
npm run release:patch  # For bug fixes
npm run release:minor  # For new features
npm run release:major  # For breaking changes
```

The release script will:
- Check for uncommitted changes
- Validate the plugin against Obsidian's requirements
- Bump the version in package.json and manifest.json
- Create a git tag
- Push to GitHub
- Trigger the GitHub Actions workflow to create a release

3. GitHub Actions will build the plugin and create a draft release with the required files:
- `main.js`
- `manifest.json`
- `styles.css`

4. Review the draft release on GitHub and publish it when ready.

## License

This project is licensed under the MIT License. See the LICENSE file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 🚨 Troubleshooting

### Plugin Freezes or Becomes Unresponsive

If the plugin freezes during indexing or becomes unresponsive, especially in large vaults (5,000+ notes):

**Quick Recovery Steps:**

1. **Force-quit Obsidian** completely (not just close the window)
2. **Remove the plugin cache** by deleting the cache directory:
   ```bash
   # Navigate to your vault's .obsidian folder and run:
   rm -rf .obsidian/plugins/related-notes
   ```
   Or manually delete the `.obsidian/plugins/related-notes` folder
3. **Restart Obsidian**
4. **Reinstall the plugin** from Community Plugins
5. The plugin will rebuild its index automatically with optimizations for large vaults

**Alternative Recovery (Preserve Settings):**

If you want to keep your plugin settings:
1. Force-quit Obsidian
2. Delete only the cache files:
   ```bash
   # In your vault's .obsidian/plugins/related-notes/ folder:
   rm -f .bloom-filter-cache.json
   rm -f bloom-filter-cache.json  
   rm -f similarity-cache.json
   ```
3. Restart Obsidian

### Index Corruption Issues

If you see errors like "Array length mismatch" or "Cache format incompatibility":

- The plugin automatically detects and fixes these issues
- If problems persist, follow the cache deletion steps above
- The plugin will rebuild with the correct format

### Performance Issues in Large Vaults

For vaults with 10,000+ notes:

- The plugin uses progressive indexing to avoid blocking Obsidian
- Initial indexing may take several minutes in the background
- Use the "Clear Cache and Re-index" button in settings if needed
- Monitor progress in the status bar

### Memory Issues

If Obsidian becomes slow or uses excessive memory:

1. Close other resource-intensive applications
2. Restart Obsidian to clear memory
3. Consider adjusting the "Maximum Suggestions" setting to a lower number
4. Use the progressive indexing feature for very large vaults

## Support

If you encounter any issues or have questions:

1. **Check the troubleshooting section above first** 👆
2. Check the [GitHub Issues](https://github.com/yourusername/obsidian-related-notes/issues)
3. Create a new issue if your problem hasn't been reported
4. Provide as much information as possible, including:
   - Steps to reproduce the issue
   - Your Obsidian version
   - Your plugin version
   - Vault size (approximate number of notes)
   - Any relevant error messages from the Developer Console (Ctrl+Shift+I)
