# Obsidian Related Notes - Claude Assistant Guide

## Build & Development Commands
- Build: `npm run build` (TypeScript check + production build)
- Development: `npm run dev` (Watch mode with ESBuild)
- Version bump: `npm run version` (Updates manifest.json and versions.json)
- TypeCheck: `tsc -noEmit -skipLibCheck` (No test commands found)

## Code Style Guidelines
- **TypeScript**: Strict mode with noImplicitAny and strictNullChecks
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces/types
- **Error Handling**: Use try/catch with console.error for error logging
- **Organization**: Split code across core.ts (algorithms), main.ts (plugin), ui.ts (views), settings.ts (config)
- **Formatting**: 2-space indentation, use 'use strict' directive
- **Exports**: Use named exports for reusable components, export default for the main plugin class
- **Comments**: JSDoc style with @file headers, document complex functions with explanations
- **Async Pattern**: Use async/await with proper error handling, yield to main thread during heavy operations
- **State Management**: Clear separation between plugin, UI, and algorithm state
- **Typescript**: Use interfaces for public APIs, prefer explicit types over any

## Development Guidelines
- Keep the `onload` function lightweight; use `onLayoutReady` for heavy initialization
- Views should be registered after layout is ready; keep view constructors lightweight
- Avoid manual detaching of leaves in `onunload` as Obsidian handles this automatically
- Yield to main thread during CPU-intensive operations with the `yieldToMain` helper
- Use smart caching to improve performance and reduce token usage

## Plugin Architecture
- **Core**: Implements similarity providers and NLP algorithms (core.ts)
- **UI**: Related notes view and interaction components (ui.ts)
- **Settings**: Configuration interface and user preferences (settings.ts)
- **Main**: Plugin initialization and coordination (main.ts)

## Key Technical Features
- Adaptive LSH parameters for large note collections
- Hybrid indexing with priority-based and on-demand computation
- Smart caching with incremental updates for changed files
- Tokenization with stop word filtering and simple stemming