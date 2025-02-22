# Code Organization Plan

## File Structure
```
.
├── main.ts               # Main plugin file and initialization
├── settings.ts          # Unified settings (UI + algorithm config)
├── core.ts             # Core algorithmic implementations
├── ui.ts              # UI components and view logic
├── utils.ts          # Utilities (logging, text processing)
└── similarity.worker.ts # Worker implementation
```

## Planned Changes

1. Settings Unification
- Merge algorithm config into settings.ts
- Keep all settings in one place for easier management
- Maintain clear separation between UI settings and algorithm settings

2. Core Logic Organization
- Keep core algorithmic implementations in core.ts
- Improve provider interfaces and implementations
- Better separation between core logic and UI

3. UI Separation
- Move UI components to ui.ts
- Keep view logic isolated from core functionality

4. Utils Cleanup
- Keep utilities organized in utils.ts
- Maintain clear utility functions
- Keep logging and text processing utilities well-structured

## Implementation Status

- [x] Merge config.ts into settings.ts
- [x] Reorganize core.ts for better separation
- [x] Move UI components to ui.ts
- [x] Clean up utils.ts
- [x] Update imports across files
- [x] Test functionality

## Completed Changes

1. Settings Unification
- Merged algorithm config into settings.ts
- Exported RelatedNotesSettings interface
- Improved type safety with proper interfaces

2. Core Logic Organization
- Separated core algorithmic implementations
- Improved provider interfaces
- Maintained clear separation between core logic and UI

3. UI Separation
- Moved UI components to ui.ts
- Kept view logic isolated from core functionality

4. Utils Cleanup
- Maintained clear utility functions
- Improved type safety with proper interfaces
- Kept logging and text processing utilities well-structured

5. Import Updates
- Updated all imports to reflect new file structure
- Fixed type issues and improved type safety
- Removed unused imports and files
