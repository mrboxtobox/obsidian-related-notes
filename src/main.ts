import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import type { RelatedNote, SimilarityProvider } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';
import type { RelatedNotesSettings } from './settings';
import { DEFAULT_SETTINGS, RelatedNotesSettingTab } from './settings';
import { MultiResolutionBloomFilterProvider } from './multi-bloom';
import { setDebugMode, logIfDebugModeEnabled, logMetrics } from './logging';
import { BATCH_PROCESSING, BLOOM_FILTER, FILE_OPERATIONS, WORD_FILTERING } from './constants';
import { handleFileError, handleIndexingError, handleUIError } from './error-handling';
import type { AppWithSettings } from './types';

'use strict';

export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings = DEFAULT_SETTINGS;
  similarityProvider?: SimilarityProvider;
  private statusBarItem?: HTMLElement;
  private isInitialized = false;
  private isReindexing = false;
  private reindexCancelled = false;
  public id: string = 'obsidian-related-notes'; // Plugin ID for settings

  /**
   * Read file content with adaptive timeout and retry logic
   * @param file The file to read
   * @param maxRetries Maximum number of retry attempts
   * @param timeoutMs Timeout in milliseconds for each attempt (adaptive based on file size)
   * @returns Promise that resolves to file content
   */
  private async readFileWithRetry(
    file: TFile,
    maxRetries: number = FILE_OPERATIONS.MAX_RETRIES,
    timeoutMs?: number
  ): Promise<string> {
    // Adaptive timeout based on file size - more generous for small files
    const baseTimeout = timeoutMs || FILE_OPERATIONS.READ_TIMEOUT_MS;
    let adaptiveTimeout: number;

    if (file.stat.size < 1024) { // Files under 1KB get shorter timeout
      adaptiveTimeout = Math.min(baseTimeout * 0.5, 5000);
    } else if (file.stat.size > 1024 * 1024) { // Files over 1MB get longer timeout
      adaptiveTimeout = baseTimeout * FILE_OPERATIONS.LARGE_FILE_TIMEOUT_MULTIPLIER;
    } else {
      adaptiveTimeout = baseTimeout;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // For very small files, try direct read first without timeout
        if (file.stat.size < 1024 && attempt === 1) {
          try {
            return await this.app.vault.cachedRead(file);
          } catch (quickError) {
            // If direct read fails, fall through to timeout logic
            // Fallback to timeout approach for small files
          }
        }

        // Create a timeout promise with adaptive timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`File read timeout after ${adaptiveTimeout}ms (file size: ${file.stat.size} bytes)`)), adaptiveTimeout);
        });

        // Race between file reading and timeout
        const content = await Promise.race([
          this.app.vault.cachedRead(file),
          timeoutPromise
        ]);

        return content;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (attempt === maxRetries) {
          logIfDebugModeEnabled(`File read failed after ${maxRetries} attempts: ${file.path} - ${errorMessage}`);
        }

        handleFileError(error as Error, 'read file', file.path);

        if (attempt === maxRetries) {
          throw new Error(`Failed to read file ${file.path} after ${maxRetries} attempts: ${errorMessage}`);
        }

        // Exponential backoff: wait longer between retries
        const backoffMs = Math.min(FILE_OPERATIONS.BASE_BACKOFF_MS * Math.pow(2, attempt - 1), FILE_OPERATIONS.MAX_BACKOFF_MS);
        // Exponential backoff retry
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }

    throw new Error(`Unexpected error in readFileWithRetry for ${file.path}`);
  }

  /**
   * Opens the plugin settings tab
   */
  public openSettings(): void {
    // Type-safe access to app settings with validation
    const app = this.app as any;
    if (app?.setting?.open && app?.setting?.openTabById) {
      app.setting.open();
      app.setting.openTabById(this.id);
    } else {
      console.error('Settings interface not available');
    }
  }

  /**
   * Clears the cache files
   * This removes all cached data and allows starting fresh
   */
  public async clearCache(): Promise<void> {
    try {
      // Get config directory
      const configDir = this.app.vault.configDir;
      const adapter = this.app.vault.adapter;

      if (!configDir || !adapter) {
        console.error('Could not access vault config directory');
        throw new Error('Could not access vault configuration');
      }

      // Define all potential cache paths to clear
      const cachePaths = [
        // Current cache file
        `${configDir}/plugins/obsidian-related-notes/.bloom-filter-cache.json`,
        // Legacy cache files
        `${configDir}/plugins/obsidian-related-notes/bloom-filter-cache.json`,
        `${configDir}/plugins/obsidian-related-notes/similarity-cache.json`,
        `${configDir}/plugins/obsidian-related-notes/.index-cache.json`,
      ];

      // Attempt to remove each cache file
      for (const cachePath of cachePaths) {
        try {
          const exists = await adapter.exists(cachePath);
          if (exists) {
            await adapter.remove(cachePath);
            // File deleted
          }
        } catch (err) {
          // Log but continue with other files
          console.error(`Failed to delete cache file ${cachePath}:`, err);
        }
      }

      // Also clear the in-memory cache by resetting the similarity provider
      if (this.similarityProvider) {
        // For MultiResolutionBloomFilterProvider, we can clear its internal cache
        if (this.similarityProvider instanceof MultiResolutionBloomFilterProvider) {
          this.similarityProvider?.clear();
        }
      }

      // Cache cleared

      // Update status bar temporarily
      this.statusBarItem?.setText('Cache cleared');
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }

      // Hide status bar after 3 seconds
      setTimeout(() => {
        this.statusBarItem?.setText('');
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }, 3000);

      // Set as uninitialized to trigger reindexing on next use
      this.isInitialized = false;

      // Reinitialize the similarity provider
      // Use setTimeout to defer to next event loop cycle
      setTimeout(() => {
        this.initializeSimilarityProvider();
      }, 1000);

    } catch (error) {
      console.error('Error clearing cache:', error);
      throw error;
    }
  }

  async onload() {
    // Load settings
    await this.loadSettings();

    // Initialize debug mode from settings
    setDebugMode(this.settings.debugMode);

    // Register essential components immediately
    this.registerCommands();

    // Add settings tab
    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    // Defer heavy initialization until layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.initializePlugin();
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
    // Update debug mode when settings are saved
    setDebugMode(this.settings.debugMode);
  }

  private async initializePlugin() {
    // Initialize UI components
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.addRibbonIcon('zap', 'Toggle related notes',
      () => this.toggleRelatedNotes(this.app.workspace));

    // Register event handlers
    this.registerEventHandlers();

    // Initialize similarity provider with caching, but don't block the UI
    this.isInitialized = false;
    const configDir = this.app.vault.configDir;

    // Delete any old cache files from previous implementations
    try {
      // Try to remove old cache files
      const oldCachePaths = [
        `${configDir}/plugins/obsidian-related-notes/similarity-cache.json`,
        `${configDir}/plugins/obsidian-related-notes/bloom-filter-cache.json`, // Non-hidden version
        `${configDir}/plugins/obsidian-related-notes/.bloom-filter-cache.json` // Old format that might be incompatible
      ];

      // Remove old cache formats but not the current one
      for (const oldCachePath of oldCachePaths) {
        await this.app.vault.adapter.remove(oldCachePath).catch(() => {
          // Ignore error if file doesn't exist
        });
      }

      // Update version tracking but don't automatically clear cache
      this.settings.lastKnownVersion = this.manifest.version;
      await this.saveSettings();

      // Removed old cache files
    } catch (error) {
      // Ignore errors when trying to delete old cache
    }

    // Use adaptive bloom filter size based on vault size
    const totalFiles = this.app.vault.getMarkdownFiles().length;
    const isLargeVault = totalFiles > WORD_FILTERING.LARGE_VAULT_THRESHOLD;
    const defaultSize = isLargeVault ? BLOOM_FILTER.LARGE_VAULT_FILTER_SIZE : BLOOM_FILTER.DEFAULT_FILTER_SIZE;
    // Make sure all bloom filters have the exact same size to prevent comparison issues
    // TODO(olu): Figure out why we're seeing file size mismatches.
    const bloomSizes = this.settings.ngramSizes.map(() => defaultSize);

    // Set default weights to ensure valid comparisons (all weights = 1.0)
    const defaultWeights = this.settings.ngramSizes.map(() => 1.0);

    // Make sure hash functions array length matches n-gram sizes
    let hashFunctions = this.settings.hashFunctions;
    if (!hashFunctions || hashFunctions.length !== this.settings.ngramSizes.length) {
      hashFunctions = this.settings.ngramSizes.map(() => 3);
    }

    // Use multi-resolution bloom filter provider with simplified settings
    this.similarityProvider = new MultiResolutionBloomFilterProvider(this.app.vault, {
      ngramSizes: this.settings.ngramSizes,
      bloomSizes: bloomSizes, // Use consistent bloom sizes to prevent size mismatch errors
      hashFunctions: hashFunctions,
      weights: defaultWeights, // Use consistent weights to ensure valid comparisons
      adaptiveParameters: true, // Always use adaptive parameters
      similarityThreshold: this.settings.similarityThreshold,
      commonWordsThreshold: this.settings.commonWordsThreshold,
      maxStopwords: this.settings.maxStopwords,
      priorityIndexSize: this.settings.priorityIndexSize,
      batchSize: this.settings.batchSize,
      // Sampling settings
      enableSampling: this.settings.enableSampling,
      sampleSizeThreshold: this.settings.sampleSizeThreshold,
      maxSampleSize: this.settings.maxSampleSize,
      // Fast word-based candidate selection (auto-enabled for medium+ vaults)
      useWordBasedCandidates: (() => {
        const totalFiles = this.app.vault.getMarkdownFiles().length;
        const threshold = WORD_FILTERING.WORD_INDEX_THRESHOLD;
        // Auto-enable for larger vaults unless explicitly disabled in settings
        const useWordIndex = totalFiles > threshold;
        if (useWordIndex) {
          logIfDebugModeEnabled(`Using word-based indexing for ${totalFiles} files (>${threshold} threshold)`);
        } else {
          logIfDebugModeEnabled(`Using bloom filter indexing for ${totalFiles} files (≤${threshold} threshold)`);
        }
        return useWordIndex;
      })()
    });

    // Show initial status
    this.statusBarItem?.setText("Loading index...");
    if (this.statusBarItem) {
      this.statusBarItem.style.display = 'block';
    }

    // Use setTimeout to defer heavy initialization to the next event loop
    // This prevents UI blocking during startup
    setTimeout(() => {
      this.initializeSimilarityProvider();
    }, 1000);
  }

  private lastStatusUpdate = 0;
  private readonly STATUS_UPDATE_THROTTLE_MS = 5000; // Update status bar at most every 5ms

  private async initializeSimilarityProvider() {
    try {
      // Initialize with throttled progress reporting to reduce DOM repainting
      await this.similarityProvider?.initialize((processed: number, total: number, currentFile?: string) => {
        const now = Date.now();

        // Throttle status bar updates to reduce repainting
        if (now - this.lastStatusUpdate < this.STATUS_UPDATE_THROTTLE_MS && processed < total) {
          return; // Skip this update
        }

        this.lastStatusUpdate = now;
        const percentage = Math.round((processed / total) * 100);
        const totalFiles = this.app.vault.getMarkdownFiles().length;
        const isLargeVault = totalFiles > WORD_FILTERING.LARGE_VAULT_THRESHOLD;
        let message = "";
        let hoverText = "";

        if (processed === 0 && total > 0) {
          message = `Checking cache...`;
          hoverText = 'Loading existing index from cache';
        } else if (processed === 0) {
          if (isLargeVault) {
            message = `Preparing large vault (${totalFiles} files)...`;
            hoverText = 'Preparing to index files in large vault';
          } else {
            message = `Indexing ${total} files...`;
            hoverText = 'Starting to index files';
          }
        } else if (processed === total) {
          if (isLargeVault) {
            message = `Related notes ready! (${total})`;
            hoverText = 'Indexing complete - related notes are available';
          } else {
            message = `Indexed ${total} files`;
            hoverText = 'Indexing complete';
          }
        } else {
          message = `Indexing: ${percentage}% (${processed}/${total})`;
          if (currentFile) {
            const fileName = currentFile.split('/').pop() || currentFile;
            hoverText = `Currently indexing: ${fileName}`;
          } else {
            hoverText = `Processing ${processed} of ${total} files`;
          }
        }

        this.statusBarItem?.setText(message);
        this.statusBarItem?.setAttribute('aria-label', hoverText);
        this.statusBarItem?.setAttribute('title', hoverText);
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'block';
        }
      });

      // Get stats for status bar
      const stats = this.similarityProvider?.getStats();

      // Check if indexing is still active
      if (stats?.indexing && (stats.indexing as any).currentFile) {
        const currentFile = (stats.indexing as any).currentFile;
        const fileName = currentFile.split('/').pop() || currentFile;
        const progressTitle = `Currently indexing: ${fileName}`;

        this.statusBarItem?.setText('Indexing...');
        this.statusBarItem?.setAttribute('aria-label', progressTitle);
        this.statusBarItem?.setAttribute('title', progressTitle);
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'block';
        }

        // Set a timer to check again
        setTimeout(() => this.updateProgressiveIndexingStatus(), 30000); // Check every 30 seconds
      } else {
        // Remove status bar item when indexing is complete
        this.statusBarItem?.setText("");
        this.statusBarItem?.removeAttribute('aria-label');
        this.statusBarItem?.removeAttribute('title');
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }

      // Check if indexing was stopped (graceful cancellation)
      if (this.similarityProvider && (this.similarityProvider as any).stopRequested) {
        this.statusBarItem?.setText("Indexing cancelled");
        setTimeout(() => {
          this.statusBarItem?.setText("");
          if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
          }
        }, 2000);
      }

      this.isInitialized = true;
    } catch (error) {
      // For any errors, show error message and log
      console.error('Error during initialization:', error);
      this.statusBarItem?.setText("Indexing error");
      setTimeout(() => {
        this.statusBarItem?.setText("");
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }, 3000);

      // Mark as initialized even on error to prevent perpetual loading state
      this.isInitialized = true;
    }
  }

  /**
   * Forces a complete re-indexing of all notes
   * Simple implementation focused on not crashing
   */
  public async forceReindex(): Promise<void> {
    // Simple check - if already reindexing, just return
    if (this.isReindexing) {
      logIfDebugModeEnabled("Reindex already in progress - request ignored");
      return;
    }

    // Check if initial indexing is still in progress
    if (!this.isInitialized) {
      this.statusBarItem?.setText("Initial indexing in progress");
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }
      setTimeout(() => {
        this.statusBarItem?.setText("Indexing in progress");
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'block';
        }
      }, 1000);
      return;
    }

    // Set reindexing state
    this.isReindexing = true;
    this.reindexCancelled = false;

    try {
      // Update status bar
      this.isInitialized = false;
      this.statusBarItem?.setText("Indexing notes");
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }

      // Create a cancellation checker function
      let lastCheckTime = Date.now();
      const checkCancellation = async () => {
        // Only check every 500ms to avoid excessive checks
        const now = Date.now();
        if (now - lastCheckTime < 500) return;

        lastCheckTime = now;

        // Use microtask to check cancellation without blocking
        return new Promise<void>((resolve, reject) => {
          setTimeout(() => {
            if (this.reindexCancelled) {
              reject(new Error('Indexing cancelled'));
            } else {
              resolve();
            }
          }, 0);
        });
      };

      // Force re-indexing with progress reporting and cancellation checks
      await this.similarityProvider?.forceReindex(async (processed: number, total: number, currentFile?: string) => {
        try {
          // Check for cancellation periodically
          if (processed % 10 === 0) {
            await checkCancellation();
          }

          const percentage = Math.min(100, Math.round((processed / Math.max(1, total)) * 100));
          let message = "";
          let phase = "Indexing";

          // Simple progress message with percentage (following Obsidian style guide)
          message = `${phase} notes: ${percentage}%`;
          let hoverText = `${phase} ${processed} of ${total} notes`;
          if (currentFile) {
            const fileName = currentFile.split('/').pop() || currentFile;
            hoverText = `Currently processing: ${fileName}`;
          }

          this.statusBarItem?.setText(message);
          this.statusBarItem?.setAttribute('aria-label', hoverText);
          this.statusBarItem?.setAttribute('title', hoverText);
          if (this.statusBarItem) {
            this.statusBarItem.style.display = 'block';
          }
        } catch (error) {
          // Propagate cancellation errors
          if (error instanceof Error && error.message === 'Indexing cancelled') {
            throw error;
          }
          // Log other errors but continue
          console.error("Error during progress update:", error);
        }
      });

      // Clear status bar after re-indexing
      this.statusBarItem?.setText("Indexing complete");
      setTimeout(() => {
        this.statusBarItem?.setText("");
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }, 3000);

      this.statusBarItem?.removeAttribute('aria-label');
      this.statusBarItem?.removeAttribute('title');

      this.isInitialized = true;

      // Refresh the view if it's open
      const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
      if (leaves.length > 0) {
        const view = leaves[0].view;
        if (view instanceof RelatedNotesView) {
          const activeView = this.app.workspace.getMostRecentLeaf()?.view;
          if (activeView instanceof MarkdownView && activeView.file) {
            await this.showRelatedNotes(this.app.workspace, activeView.file);
          }
        }
      }
    } catch (error) {
      // If indexing was cancelled, update the status bar
      if (error instanceof Error && error.message === 'Indexing cancelled') {
        this.statusBarItem?.setText("Re-indexing cancelled");
        setTimeout(() => {
          this.statusBarItem?.setText("");
          if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
          }
        }, 2000);

        // Restore initialized state
        this.isInitialized = true;
      } else {
        // For other errors, log and update status bar
        console.error('Error during re-indexing:', error);
        this.statusBarItem?.setText("Error during re-indexing");
        setTimeout(() => {
          this.statusBarItem?.setText("");
          if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
          }
        }, 2000);

        // Restore initialized state for other errors too
        this.isInitialized = true;
      }
    } finally {
      // Always reset reindexing state, no matter what happens
      this.isReindexing = false;
    }
  }

  /**
   * Cancels the current re-indexing operation
   */
  public cancelReindex(): void {
    if (this.isReindexing) {
      this.reindexCancelled = true;
      // Also stop the similarity provider directly
      this.similarityProvider?.stop();
      // Update the status immediately (following Obsidian style guide)
      this.statusBarItem?.setText("Indexing cancelled");
      // Hide status after a short delay
      setTimeout(() => {
        this.statusBarItem?.setText("");
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }, 2000);
      // Restore initialized state
      this.isInitialized = true;
    }
  }

  private registerEventHandlers() {
    this.registerEvent(
      this.app.workspace.on('file-open',
        (file: TFile | null) => this.showRelatedNotes(this.app.workspace, file))
    );

    // Track file changes to update the index
    this.registerEvent(
      this.app.vault.on('create', (file) => {
        if (file instanceof TFile && this.isMarkdownFile(file)) {
          this.updateIndexForFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('modify', (file) => {
        if (file instanceof TFile && this.isMarkdownFile(file)) {
          this.updateIndexForFile(file);
        }
      })
    );

    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && this.isMarkdownFile(file)) {
          // Remove from word index for fast candidate selection
          if (this.similarityProvider instanceof MultiResolutionBloomFilterProvider) {
            const provider = this.similarityProvider as any;
            if (provider.wordCandidateSelector && provider.useWordBasedCandidates) {
              provider.wordCandidateSelector.removeDocument(file.path);
            }
            // Mark as dirty to trigger cache save
            provider.cacheDirty = true;
          }
        }
      })
    );
  }

  /**
   * Update the index for a single file
   * Uses a debounce mechanism to avoid excessive processing
   */
  private fileUpdateQueue = new Set<string>();
  private processingQueue = false;
  private lastProcessTime = 0;
  private readonly PROCESS_INTERVAL = BATCH_PROCESSING.PROCESS_INTERVAL_MS; // 2 seconds between batches
  private readonly MAX_BATCH_SIZE = 5; // Process at most 5 files at once
  private queueProcessingTimeout: number | null = null;

  private async updateIndexForFile(file: TFile): Promise<void> {
    if (!this.isInitialized || !this.similarityProvider) return;

    // Add file to queue
    this.fileUpdateQueue.add(file.path);

    // Start queue processing if not already running
    if (!this.processingQueue) {
      this.processingQueue = true;
      this.processFileQueue();
    }
  }

  private async processFileQueue(): Promise<void> {
    // Respect minimum interval between processing batches
    const now = Date.now();
    const timeSinceLastProcess = now - this.lastProcessTime;

    if (timeSinceLastProcess < this.PROCESS_INTERVAL && this.lastProcessTime > 0) {
      // Wait until interval has passed
      await new Promise(resolve =>
        setTimeout(resolve, this.PROCESS_INTERVAL - timeSinceLastProcess)
      );
    }

    // Nothing to process
    if (this.fileUpdateQueue.size === 0) {
      this.processingQueue = false;
      return;
    }

    this.lastProcessTime = Date.now();

    // Process a batch of files
    const batch = Array.from(this.fileUpdateQueue).slice(0, this.MAX_BATCH_SIZE);

    // Remove processed files from queue
    for (const filePath of batch) {
      this.fileUpdateQueue.delete(filePath);
    }

    // Process each file in the batch
    for (const filePath of batch) {
      try {
        const file = this.app.vault.getAbstractFileByPath(filePath);
        if (file instanceof TFile) {
          // Get file content with timeout and retry logic
          const content = await this.readFileWithRetry(file);

          // Extract title from the file path and add it to the content for improved matching
          const fileName = file.basename;
          const enhancedContent = `${fileName} ${content}`;

          // Process with a yield to keep UI responsive
          await new Promise(resolve => setTimeout(resolve, 10));
          await this.similarityProvider?.processDocument(file.path, enhancedContent);
        }
      } catch (error) {
        handleIndexingError(error as Error, filePath, { operation: 'file index update' });
      }
    }

    // Continue processing if there are more files
    if (this.fileUpdateQueue.size > 0) {
      // TODO(olu): We will need to bound how many times we recurse here.
      this.processFileQueue();
    } else {
      this.processingQueue = false;
    }
  }

  private registerCommands() {
    this.addCommand({
      id: 'toggle-related-notes',
      name: 'Toggle related notes',
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.toggleRelatedNotes(this.app.workspace);
        }
        return true;
      }
    });
  }

  async onunload() {
    // Stop all ongoing operations first
    if (this.similarityProvider) {
      try {
        // Stop any indexing operations
        this.similarityProvider?.stop();
      } catch (error) {
        handleUIError(error as Error, 'plugin unload', 'stop operations');
      }
    }

    // Cancel reindexing if in progress
    if (this.isReindexing) {
      this.cancelReindex();
    }

    // Clear any pending file updates and timeouts
    this.fileUpdateQueue.clear();
    this.processingQueue = false;
    if (this.queueProcessingTimeout) {
      clearTimeout(this.queueProcessingTimeout);
      this.queueProcessingTimeout = null;
    }

    // Clear cache when plugin is disabled to avoid stale data
    if (this.similarityProvider instanceof MultiResolutionBloomFilterProvider) {
      try {
        // Clear cache with timeout to prevent hanging
        await Promise.race([
          (this.similarityProvider as MultiResolutionBloomFilterProvider).deleteCache(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Cache clear timeout')), 5000)
          )
        ]);
        console.info('[RelatedNotes] Cache cleared on plugin disable');
      } catch (error) {
        handleUIError(error as Error, 'plugin unload', 'clear cache');
      }
    }

    // Clean up similarity provider
    this.similarityProvider = undefined;

    // Reset all state flags
    this.isInitialized = false;
    this.isReindexing = false;
    this.reindexCancelled = false;

    // Obsidian automatically detaches leaves when a plugin is unloaded
    // Note: We don't manually detach leaves here to avoid breaking user experience
  }

  private async toggleRelatedNotes(workspace: Workspace) {
    const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

    if (leaves.length > 0) {
      workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
      return;
    }

    await this.createAndInitializeView();
  }

  private async createAndInitializeView() {
    const leaf = this.app.workspace.getRightLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });

    const view = leaf.view;
    if (!(view instanceof RelatedNotesView)) return;

    const activeView = this.app.workspace.getMostRecentLeaf()?.view;
    if (activeView instanceof MarkdownView && activeView.file) {
      await this.showRelatedNotes(this.app.workspace, activeView.file);
    } else {
      await view.reset();
    }

    this.app.workspace.revealLeaf(leaf);
  }

  public isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === 'md';
  }

  public isInitializationComplete(): boolean {
    return this.isInitialized;
  }

  /**
   * Checks if re-indexing is currently in progress
   */
  public isReindexingInProgress(): boolean {
    return this.isReindexing;
  }

  /**
   * Updates the status bar with indexing information
   * Called periodically to refresh the status
   */
  private updateProgressiveIndexingStatus(): void {
    // Only update if we're initialized
    if (!this.isInitialized) return;

    // Get the latest stats
    const stats = this.similarityProvider?.getStats();

    // Check if indexing is still active
    if (stats?.indexing && (stats.indexing as any).currentFile) {
      const currentFile = (stats.indexing as any).currentFile;
      const fileName = currentFile.split('/').pop() || currentFile;
      const progressTitle = `Currently indexing: ${fileName}`;

      this.statusBarItem?.setText('Indexing...');
      this.statusBarItem?.setAttribute('aria-label', progressTitle);
      this.statusBarItem?.setAttribute('title', progressTitle);
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }

      // Schedule another update
      setTimeout(() => this.updateProgressiveIndexingStatus(), 30000); // Check every 30 seconds
    } else {
      // No longer indexing, hide the status
      this.statusBarItem?.setText("");
      this.statusBarItem?.removeAttribute('aria-label');
      this.statusBarItem?.removeAttribute('title');
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'none';
      }
    }
  }

  private async showRelatedNotes(workspace: Workspace, file: TFile | null) {
    if (!(file instanceof TFile)) return;

    const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    if (leaves.length === 0) return;

    const view = leaves[0].view;
    if (!(view instanceof RelatedNotesView)) return;

    const relatedNotes = await this.getRelatedNotes(file);
    await view.updateForFile(file, relatedNotes);
  }

  private async getRelatedNotes(file: TFile): Promise<Array<RelatedNote>> {
    try {
      // Get candidates, potentially with sampling
      const candidates = await this.similarityProvider?.getCandidateFiles(file) || [];

      // Calculate similarities for all candidates
      const similarityPromises = candidates.map(async (candidate) => {
        try {
          const similarity = await this.similarityProvider?.computeCappedCosineSimilarity(file, candidate);
          return {
            file: candidate,
            similarity: similarity?.similarity || 0,
            isPreIndexed: true
          };
        } catch (error) {
          console.warn(`Error computing similarity for ${candidate.path}:`, error);
          return {
            file: candidate,
            similarity: 0,
            isPreIndexed: true
          };
        }
      });

      // Await all similarity calculations
      const relatedNotes: RelatedNote[] = await Promise.all(similarityPromises);

      // Sort by similarity (highest first)
      const sortedNotes = relatedNotes
        .filter(note => note.similarity > 0) // Filter out zero similarities
        .sort((a, b) => b.similarity - a.similarity);

      // If we have good results, return them
      if (sortedNotes.length > 0) {
        return sortedNotes.slice(0, this.settings.maxSuggestions);
      }

    } catch (error) {
      console.error(`Error getting related notes for ${file.path}:`, error);
    }
    return [];
  }
}