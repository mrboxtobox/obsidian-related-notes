/**
 * @file Type definitions for the Related Notes plugin
 */

import type { App } from 'obsidian';

/**
 * Extended App interface with settings functionality
 */
export interface AppWithSettings extends App {
  setting: {
    open(): void;
    openTabById(id: string): void;
  };
}

/**
 * Mock vault interface for testing
 */
export interface MockVault {
  configDir: string;
  adapter: {
    exists(path: string): Promise<boolean>;
    read(path: string): Promise<string>;
    write(path: string, content: string): Promise<void>;
    remove?(path: string): Promise<void>;
  };
  getMarkdownFiles?(): any[];
  getActiveLeaf?(): any;
}

/**
 * Cache validation result
 */
export interface CacheValidationResult {
  isValid: boolean;
  reason?: string;
}

/**
 * File operation options
 */
export interface FileOperationOptions {
  maxRetries?: number;
  timeoutMs?: number;
  backoffMs?: number;
}

/**
 * Progressive indexing stats
 */
export interface ProgressiveIndexingStats {
  active: boolean;
  remainingFiles: number;
  totalFiles: number;
  completedFiles: number;
}

/**
 * Provider statistics
 */
export interface ProviderStats {
  documentsIndexed: number;
  averageDocumentLength: number;
  totalMemoryUsage: number;
  bloomFilterStats: Record<string, any>;
  progressiveIndexing?: ProgressiveIndexingStats;
}