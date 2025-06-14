# Claude Code Memory for obsidian-related-notes

## Build Commands
```bash
# Build the plugin
npm run build

# Copy to test vaults
./copy-to-vault.sh
```

## Project Structure Notes
- This plugin implements "Related Notes" functionality for Obsidian
- Uses different similarity algorithms (MinHash, Bloom Filter) for finding related notes
- Performance optimization strategies:
  - Lazy indexing: compute similarities on-the-fly and cache results
  - Pre-indexing commonly accessed notes
  - Bloom filter for large vaults

## Code Style Preferences
- More concrete progress indicators (e.g., "Computing index", "Building similarity matrix")
- Non-colored status icons for better accessibility
- Simple, straightforward UI updates
- Prefer simpler implementations over complex ones
- Extensively document complex sections of the code, using ASCII diagrams as needed
- Keep all documentation in README.md files rather than separate documentation files