# Related Notes Plugin Development Notes

## Load Time Optimization

The plugin has been optimized for faster load times by implementing the following strategies:

1. **Deferred Initialization**
   - Heavy initialization moved to `onLayoutReady` callback
   - Only essential components registered during initial `onload`
   - View registration deferred until after app layout is ready

2. **Initialization Order**
   ```mermaid
   graph TD
      A[Plugin onload] --> B[Register Commands]
      A --> C[Create Status Bar]
      C --> D[onLayoutReady]
      D --> E[Initialize UI]
      D --> F[Register Event Handlers]
      D --> G[Initialize Similarity Provider]
   ```

3. **Performance Considerations**
   - Status bar provides immediate feedback during initialization
   - View creation deferred until needed
   - Heavy computation happens after app is interactive

## Development Guidelines

When making changes to the plugin:

1. Keep the `onload` function lightweight
   - Only register essential components
   - Use `onLayoutReady` for heavy initialization
   - Avoid synchronous operations that could block app startup

2. View Management
   - Views should be registered after layout is ready
   - Keep view constructors lightweight
   - Defer expensive operations in views until they're actually needed

3. Similarity Provider
   - Initialization is deferred until after app startup
   - Progress updates through status bar
   - Sampling large note collections for better performance

## Best Practices

1. **Production Build**
   - Always use production builds for releases
   - Enable minification in build configuration
   - Remove development/testing code

2. **Startup Performance**
   - Minimize synchronous operations in `onload`
   - Use `onLayoutReady` for non-critical initialization
   - Consider lazy loading for expensive features

3. **View Performance**
   - Keep view constructors minimal
   - Load data only when views become visible
   - Clean up resources when views are closed

## Future Considerations

1. Consider implementing:
   - Caching for similarity computations
   - Lazy loading for similarity provider
   - Configuration options for initialization behavior
   - Progressive loading of related notes

2. Monitor:
   - Memory usage during initialization
   - Time spent in each initialization phase
   - Impact on Obsidian startup time
