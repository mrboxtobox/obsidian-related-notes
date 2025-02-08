# Related Notes Plugin for Obsidian

A powerful plugin for Obsidian that automatically discovers and suggests related notes using Natural Language Processing (NLP) and BM25 similarity analysis. It helps you uncover connections between your notes that you might have missed.

## Features

- 🔍 Automatically analyzes note content using NLP techniques
- 📊 Uses BM25 (Best Matching 25) for accurate content-based similarity matching
- 🎯 Configurable similarity threshold for fine-tuned suggestions
- 🔗 Smart "Add Link" button that shows when a link already exists
- 💾 Smart caching with file modification tracking
- 📄 Intelligent file type filtering (only processes text-based files)
- ⚡ Real-time updates as you edit notes
- 🎨 Clean, native-looking UI that matches Obsidian's theme

## Installation

1. Open Obsidian Settings
2. Navigate to Community Plugins and disable Safe Mode
3. Click Browse and search for "Related Notes"
4. Click Install
5. Enable the plugin in the Community Plugins tab

## Usage

### Viewing Related Notes

1. Click the dice icon in the ribbon to open the Related Notes pane
2. The plugin will automatically show related notes for your currently active note
3. You can also use the command palette and search for "Find Related Notes"

### Adding Links

1. When viewing related notes, click the "Add Link" button next to any suggestion
2. A link to that note will be inserted at your current cursor position
3. Once linked, the button will change to "Linked" to indicate the connection exists

## Configuration

The plugin can be configured through the settings tab:

- **Debug Mode**: Enable detailed logging for troubleshooting and development
- **Similarity Threshold** (0-1): Minimum similarity score required to consider notes as related
- **Maximum Suggestions** (1-10): Maximum number of related notes to display

### File Type Support

The plugin processes the following file types:
- Markdown (.md)
- Text (.txt)
- Web files (.html, .css, .js, .jsx, .ts, .tsx)
- Configuration files (.json, .yml, .yaml)

Other file types (like images, PDFs, etc.) are automatically skipped to optimize performance.

### Caching System

The plugin uses a sophisticated caching system to improve performance:
- Vectors are cached in memory and persisted to disk
- Cache invalidation based on file modification time (automatically recomputes if file changes)
- Smart cache management to prevent unnecessary recomputation

### Debug Logging

When Debug Mode is enabled, the plugin provides detailed logging about its operations:

- Text processing and tokenization details
- BM25 calculations and similarity scores
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

- Node.js 16+
- npm or yarn
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

- `main.ts` - Main plugin file with core functionality
- `settings.ts` - Settings tab implementation
- `ui.ts` - Related notes view implementation
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
