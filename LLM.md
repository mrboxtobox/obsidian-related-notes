# LLM Context for Obsidian Related Notes Plugin

## Project Overview
This is a production-ready Obsidian plugin that suggests related notes using NLP and TF-IDF similarity analysis. The plugin is at version 1.0.0 and uses modern dependencies for natural language processing and data persistence.

## Key Files
- `main.ts` - Core plugin functionality
- `settings.ts` - Settings management
- `ui.ts` - UI components for related notes view
- `types.d.ts` - TypeScript type definitions
- `styles.css` - Plugin styling
- `manifest.json` - Plugin metadata
- `package.json` - Project configuration and dependencies

## Current State
- Version: 1.0.0
- Status: Production-ready
- Minimum Obsidian Version: 0.15.0

## Dependencies
### Production
- natural@8.0.1 - NLP functionality
- levelup@5.1.1 - Database management
- leveldown@6.1.1 - Storage engine

### Development
- TypeScript 4.4.4
- esbuild 0.19.12
- Various type definitions and development utilities

## Build Process
The project uses esbuild for bundling and includes:
- Development build with hot-reload (`npm run dev`)
- Production build (`npm run build`)
- Version management script (`npm run version`)

## Future Development Guidelines
1. **Version Updates**
   - Use `npm run version` to update version numbers
   - This updates both manifest.json and versions.json
   - Commit changes after version bump

2. **Dependency Management**
   - Keep dependencies up to date but test thoroughly
   - Consider Obsidian API compatibility when updating

3. **Testing Areas**
   - NLP functionality with various note contents
   - Cache performance with large vaults
   - UI responsiveness
   - Settings persistence

4. **Production Checklist**
   - [x] Version numbers synchronized
   - [x] Dependencies up to date
   - [x] Build process configured
   - [x] Documentation complete
   - [x] License included
   - [x] Manifest configured

## Outstanding Tasks
None currently - the plugin is production-ready with all core functionality implemented.

## Notes for LLMs
1. Always check version numbers in both manifest.json and package.json when making updates
2. The plugin uses modern ES modules - maintain this pattern
3. UI components should follow Obsidian's design patterns
4. Cache implementation is critical for performance
5. Consider mobile compatibility (plugin is not desktop-only)
