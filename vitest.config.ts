import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', '.obsidian'],
    reporters: ['default', 'json'],
    outputFile: 'vitest.results.json',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  benchmark: {
    include: ['src/**/*.bench.ts'],
    reporters: ['default'],
    outputFile: 'bench-results.json',
  },
});