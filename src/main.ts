import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import type { RelatedNote, SimilarityProvider } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';
import type { RelatedNotesSettings } from './settings';
import { DEFAULT_SETTINGS, RelatedNotesSettingTab } from './settings';
import { MultiResolutionBloomFilterProvider } from './multi-bloom';
import { setDebugMode } from './logging';
import { BATCH_PROCESSING, BLOOM_FILTER, FILE_OPERATIONS } from './constants';
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
   * Read file content with timeout and retry logic
   * @param file The file to read
   * @param maxRetries Maximum number of retry attempts
   * @param timeoutMs Timeout in milliseconds for each attempt
   * @returns Promise that resolves to file content
   */
  private async readFileWithRetry(
    file: TFile, 
    maxRetries: number = FILE_OPERATIONS.MAX_RETRIES, 
    timeoutMs: number = FILE_OPERATIONS.READ_TIMEOUT_MS
  ): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`File read timeout after ${timeoutMs}ms`)), timeoutMs);
        });

        // Race between file reading and timeout
        const content = await Promise.race([
          this.app.vault.cachedRead(file),
          timeoutPromise
        ]);

        return content;
      } catch (error) {
        handleFileError(error as Error, 'read file', file.path);
        
        if (attempt === maxRetries) {
          throw new Error(`Failed to read file ${file.path} after ${maxRetries} attempts: ${error}`);
        }
        
        // Exponential backoff: wait longer between retries
        const backoffMs = Math.min(FILE_OPERATIONS.BASE_BACKOFF_MS * Math.pow(2, attempt - 1), FILE_OPERATIONS.MAX_BACKOFF_MS);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
      }
    }
    
    throw new Error(`Unexpected error in readFileWithRetry for ${file.path}`);
  }

  /**
   * Opens the plugin settings tab
   */
  public openSettings(): void {
    // Type-safe access to app settings
    const app = this.app as AppWithSettings;
    app.setting.open();
    app.setting.openTabById(this.id);
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
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem?.setText("Initializing");
    if (this.statusBarItem) {
      this.statusBarItem.style.display = 'block';
    }

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

    // Ensure all bloom filters use the same size
    const defaultSize = BLOOM_FILTER.DEFAULT_FILTER_SIZE; // Increased filter size to reduce false positives
    // Make sure all bloom filters have the exact same size to prevent comparison issues
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
    });

    // Show initial status
    this.statusBarItem?.setText("Indexing notes...");
    if (this.statusBarItem) {
      this.statusBarItem.style.display = 'block';
    }

    // Use setTimeout to defer heavy initialization to the next event loop
    // This prevents UI blocking during startup
    setTimeout(() => {
      this.initializeSimilarityProvider();
    }, 1000);
  }

  private async initializeSimilarityProvider() {
    try {
      // Initialize with progress reporting and smooth transitions
      // Pass the skipInitialIndexing setting to prevent reindexing on every load
      await this.similarityProvider?.initialize((processed, total) => {
        const percentage = Math.round((processed / total) * 100);
        let message = "";
        const phase = "Indexing";

        // Simple progress message with percentage (following Obsidian style guide)
        message = `${phase} notes: ${percentage}%`;

        this.statusBarItem?.setText(message);
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'block';
        }
      });

      // Get stats for status bar
      const stats = this.similarityProvider?.getStats();
      const totalFiles = this.app.vault.getMarkdownFiles().length;

      // Check if progressive indexing is active
      if (stats?.progressiveIndexing && typeof stats.progressiveIndexing === 'object' && stats.progressiveIndexing !== null && 'active' in stats.progressiveIndexing && (stats.progressiveIndexing as any).active) {
        const remaining = (stats.progressiveIndexing as any).remainingFiles || 0;
        const total = Math.max(totalFiles, 1); // Avoid division by zero
        const indexed = Math.max(0, Math.min(total - remaining, total)); // Ensure value is between 0 and total
        const percent = Math.max(0, Math.min(100, Math.round((indexed / total) * 100))); // Bound between 0-100

        // Show a subtle indicator that progressive indexing is active
        this.statusBarItem?.setText(`Indexing: ${percent}%`);
        this.statusBarItem?.setAttribute('aria-label', `Progressively indexing ${remaining} remaining files`);
        this.statusBarItem?.setAttribute('title', `Progressively indexing ${remaining} remaining files`);
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'block';
        }

        // Set a timer to periodically update the status
        setTimeout(() => this.updateProgressiveIndexingStatus(), 60000); // Check every minute
      } else {
        // Remove status bar item when indexing is complete
        this.statusBarItem?.setText("");
        this.statusBarItem?.removeAttribute('aria-label');
        this.statusBarItem?.removeAttribute('title');
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }

      this.isInitialized = true;
    } catch (error) {
      // Handle cancellation error explicitly
      if (error instanceof Error && error.message === 'Indexing cancelled') {
        // Set a proper status message
        this.statusBarItem?.setText("Indexing cancelled");
        setTimeout(() => {
          this.statusBarItem?.setText("");
          if (this.statusBarItem) {
            this.statusBarItem.style.display = 'none';
          }
        }, 2000);

        // Even if cancelled, mark as initialized to prevent blocking the UI
        this.isInitialized = true;
      } else {
        // For other errors, show error message
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
  }

  /**
   * Forces a complete re-indexing of all notes
   * This is useful when the user wants to ensure the index is up-to-date
   * @throws Error if indexing is cancelled
   */
  public async forceReindex(): Promise<void> {
    // Check if already reindexing or initial indexing is still in progress
    if (this.isReindexing) {
      this.statusBarItem?.setText("Already indexing");
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
      await this.similarityProvider?.forceReindex(async (processed, total) => {
        try {
          // Check for cancellation periodically
          if (processed % 10 === 0) {
            await checkCancellation();
          }

          const percentage = Math.min(100, Math.round((processed / Math.max(1, total)) * 100));
          let message = "";
          let phase = "";

          // Simplified phases with minimal text
          if (percentage <= 33) {
            phase = "Processing";
          } else if (percentage <= 66) {
            phase = "Analyzing";
          } else {
            phase = "Indexing";
          }

          // Simple progress message with percentage (following Obsidian style guide)
          message = `${phase} notes: ${percentage}%`;
          this.statusBarItem?.setText(message);
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
      // Reset reindexing state
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
          // Just mark the similarity provider as dirty to trigger a save
          // The specific file handling is done inside the provider
          if (this.similarityProvider instanceof MultiResolutionBloomFilterProvider) {
            (this.similarityProvider as any).cacheDirty = true;
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

    // Clear any pending file updates
    this.fileUpdateQueue.clear();
    this.processingQueue = false;

    // Save cache before unloading
    if (this.similarityProvider instanceof MultiResolutionBloomFilterProvider) {
      try {
        // Call the public method
        await (this.similarityProvider as MultiResolutionBloomFilterProvider).saveCache();
      } catch (error) {
        handleUIError(error as Error, 'plugin unload', 'save cache');
      }
    }

    // Clean up similarity provider
    this.similarityProvider = undefined;

    // Reset initialization state
    this.isInitialized = false;

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
   * Updates the status bar with progressive indexing information
   * Called periodically to refresh the status
   */
  private updateProgressiveIndexingStatus(): void {
    // Only update if we're initialized
    if (!this.isInitialized) return;

    // Get the latest stats
    const stats = this.similarityProvider?.getStats();

    // Check if progressive indexing is still active
    if (stats?.progressiveIndexing && typeof stats.progressiveIndexing === 'object' && stats.progressiveIndexing !== null && 'active' in stats.progressiveIndexing && (stats.progressiveIndexing as any).active) {
      const remaining = (stats.progressiveIndexing as any).remainingFiles || 0;
      const totalFiles = Math.max(this.app.vault.getMarkdownFiles().length, 1); // Avoid division by zero
      const indexed = Math.max(0, Math.min(totalFiles - remaining, totalFiles)); // Ensure value is between 0 and total
      const percent = Math.max(0, Math.min(100, Math.round((indexed / totalFiles) * 100))); // Bound between 0-100

      // Update the status bar
      this.statusBarItem?.setText(`Indexing: ${percent}%`);
      this.statusBarItem?.setAttribute('aria-label', `Progressively indexing ${remaining} remaining files`);
      this.statusBarItem?.setAttribute('title', `Progressively indexing ${remaining} remaining files`);
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }

      // Schedule another update
      setTimeout(() => this.updateProgressiveIndexingStatus(), 60000); // Check every minute
    } else {
      // No longer doing progressive indexing, hide the status
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
    // Get candidates from the similarity provider
    // Use sampling for large vaults
    const markdownFiles = this.app.vault.getMarkdownFiles();
    const totalFiles = markdownFiles.length;

    // Get sampling settings from plugin settings
    const { enableSampling, sampleSizeThreshold, maxSampleSize } = this.settings;

    // Calculate adaptive sample size if sampling is enabled
    const sampleSize = enableSampling && totalFiles > sampleSizeThreshold
      ? Math.min(Math.ceil(totalFiles * 0.2), maxSampleSize)
      : undefined; // undefined means no sampling

    // Get candidates, potentially with sampling
    const candidates = this.similarityProvider?.getCandidateFiles(file) || [];

    // Add informational message to status bar if sampling is active
    if (sampleSize && totalFiles > sampleSizeThreshold) {
      this.statusBarItem?.setText(`Large vault detected - sampling ${sampleSize} of ${totalFiles} files`);
      if (this.statusBarItem) {
        this.statusBarItem.style.display = 'block';
      }

      // Hide status bar after 3 seconds
      setTimeout(() => {
        this.statusBarItem?.setText("");
        if (this.statusBarItem) {
          this.statusBarItem.style.display = 'none';
        }
      }, 3000);
    }

    // Calculate similarities for all candidates
    const similarityPromises = candidates.map(async (candidate) => {
      const similarity = await this.similarityProvider?.computeCappedCosineSimilarity(file, candidate);
      return {
        file: candidate,
        similarity: similarity?.similarity || 0,
        isPreIndexed: true
      };
    });

    // Await all similarity calculations
    const relatedNotes: RelatedNote[] = await Promise.all(similarityPromises);

    // Sort by similarity (highest first)
    const sortedNotes = relatedNotes.sort((a, b) => b.similarity - a.similarity);

    // Return top N notes according to settings
    return sortedNotes.slice(0, this.settings.maxSuggestions);
  }
}