import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      // The published `obsidian` package is types-only (empty `main`) because the
      // real API is injected by the app at runtime, so importing it under vitest
      // fails to resolve. Point it at a stub. See tests/stubs/obsidian.ts.
      obsidian: fileURLToPath(new URL('./tests/stubs/obsidian.ts', import.meta.url))
    }
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}', 'tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    exclude: ['node_modules', 'dist', '.idea', '.git', '.cache'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['node_modules/', 'dist/', 'coverage/', '**/*.d.ts', '**/*.config.*', 'tests/stubs/']
    }
  }
});