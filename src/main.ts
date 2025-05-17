import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import { RelatedNote, SimilarityProvider } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';
import { RelatedNotesSettings, DEFAULT_SETTINGS, RelatedNotesSettingTab } from './settings';
import { Logger } from './logger';
import { SimHashProvider } from './similarity';

'use strict';

export interface MemoryStats {
  numDocuments: number;
  numBands: number;
  rowsPerBand: number;
  totalBuckets: number;
  maxBucketSize: number;
  avgBucketSize: number;
  cacheSize: number;
  estimatedMemoryUsage: number;
  onDemandIndexedCount: number;
  totalIndexedCount: number;
}

export interface NLPStats {
  similarityProvider: string;
  shingleSize: number;
  useWordShingles: boolean;
  numHashes: number;
  isCorpusSampled: boolean;
  totalFiles: number;
  indexedFiles: number;
  onDemandComputations: number;
}

export default class RelatedNotesPlugin extends Plugin {
  settings!: RelatedNotesSettings;
  similarityProvider!: SimilarityProvider;
  private statusBarItem!: HTMLElement;
  private isInitialized = false;
  private isReindexing = false;
  private reindexCancelled = false;

  async onload() {
    await this.loadSettings();

    this.registerCommands();
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("Initializing...");

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
  }

  private async initializePlugin() {
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.addRibbonIcon('zap', 'Show related notes',
      () => this.createAndInitializeView());

    this.registerEventHandlers();
    this.isInitialized = false;

    // Determine the best similarity provider based on vault size
    const files = this.app.vault.getMarkdownFiles();
    const isLargeVault = files.length > 10000;
    
    // Always use SimHash for better similarity detection
    // SimHash is faster and more memory-efficient for large vaults
    this.similarityProvider = new SimHashProvider(this.app.vault, {
      simhash: {
        // For large vaults, use more aggressive chunking and larger shingles
        hashBits: 64,
        shingleSize: isLargeVault ? 3 : 2, // Larger shingles for better quality in large vaults
        useChunkIndex: true,
        chunkCount: isLargeVault ? 8 : 4,  // More chunks for better indexing in large vaults
        maxDistance: Math.floor((1 - this.settings.similarityThreshold) * 64) // Adaptive distance threshold
      },
      similarityThreshold: this.settings.similarityThreshold,
      maxRelatedNotes: this.settings.maxSuggestions
    });

    this.statusBarItem.setText("Ready (indexing in background)");

    // Use requestAnimationFrame for more responsive UI during initialization
    // This helps prevent UI blocking better than setTimeout
    requestAnimationFrame(() => {
      this.initializeSimilarityProvider();
    });
  }

  /**
   * Initialize the similarity provider with progress reporting
   * This is optimized to minimize UI updates and be more efficient
   */
  private async initializeSimilarityProvider() {
    this.statusBarItem.setText("Loading related notes...");
    
    // Track last update time to throttle UI updates
    let lastUpdateTime = 0;
    const MIN_UPDATE_INTERVAL = 100; // Update UI at most every 100ms
    
    // Define phases for better user experience
    const phases = [
      { threshold: 25, message: "Reading your notes" },
      { threshold: 50, message: "Analyzing patterns" },
      { threshold: 75, message: "Finding connections" },
      { threshold: 100, message: "Building relationships" }
    ];
    
    // Current phase to avoid redundant updates
    let currentPhase = -1;
    
    await this.similarityProvider.initialize((percent, total) => {
      const now = Date.now();
      
      // Skip updates that are too frequent (throttling)
      if (now - lastUpdateTime < MIN_UPDATE_INTERVAL) {
        return;
      }
      
      // Determine the current phase
      let phaseIndex = 0;
      for (let i = 0; i < phases.length; i++) {
        if (percent <= phases[i].threshold) {
          phaseIndex = i;
          break;
        }
      }
      
      // Only update if phase changed or significant progress (5% increments)
      if (phaseIndex !== currentPhase || Math.floor(percent / 5) !== Math.floor((percent - 1) / 5)) {
        currentPhase = phaseIndex;
        const phase = phases[phaseIndex].message;
        const message = `${phase}... ${percent}%`;
        this.statusBarItem.setText(message);
        lastUpdateTime = now;
      }
    });

    // Optimized file access time updates in batches
    const allFiles = this.app.vault.getMarkdownFiles();
    if ('updateFileAccessTime' in this.similarityProvider) {
      // Process in batches to avoid UI blocking
      const BATCH_SIZE = 100;
      for (let i = 0; i < allFiles.length; i += BATCH_SIZE) {
        const batch = allFiles.slice(i, i + BATCH_SIZE);
        
        // Update access times for this batch
        batch.forEach(file => {
          this.similarityProvider.updateFileAccessTime(file);
        });
        
        // Yield to main thread after each batch
        if (i + BATCH_SIZE < allFiles.length) {
          await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
      }
    }

    // Update UI based on corpus sampling status
    if (this.similarityProvider.isCorpusSampled()) {
      this.statusBarItem.setText("⚠️ Using a sample of your notes");
      this.statusBarItem.setAttribute('aria-label', 'For better performance, Related Notes is using a sample of up to 10000 notes');
      this.statusBarItem.setAttribute('title', 'For better performance, Related Notes is using a sample of up to 10000 notes');
    } else {
      this.statusBarItem.setText("Ready to find related notes");
      this.statusBarItem.removeAttribute('aria-label');
      this.statusBarItem.removeAttribute('title');
    }
    
    this.isInitialized = true;
  }

  /**
   * Forces a complete re-indexing of all notes
   * This is useful when the user wants to ensure the index is up-to-date
   * @throws Error if indexing is cancelled
   */
  public async forceReindex(): Promise<void> {
    // Check if already reindexing or initial indexing is still in progress
    if (this.isReindexing) {
      this.statusBarItem.setText("Already re-indexing, please wait...");
      setTimeout(() => {
        this.statusBarItem.setText("Re-indexing in progress...");
      }, 2000);
      return;
    }

    if (!this.isInitialized) {
      this.statusBarItem.setText("Initial indexing in progress, please wait...");
      setTimeout(() => {
        this.statusBarItem.setText("Indexing in progress...");
      }, 2000);
      return;
    }

    this.isReindexing = true;
    this.reindexCancelled = false;

    try {
      this.isInitialized = false;
      this.statusBarItem.setText("Re-indexing notes...");

      await this.similarityProvider.forceReindex((percent) => {
        // Periodically yield to main thread to check for cancellation
        const yieldToMainAndCheckCancellation = async () => {
          await new Promise<void>((resolve, reject) => {
            setTimeout(() => {
              if (this.reindexCancelled) {
                reject(new Error('Indexing cancelled'));
              } else {
                resolve();
              }
            }, 0);
          });
        };

        if (percent % 5 === 0) {
          yieldToMainAndCheckCancellation();
        }

        let message = "";
        let phase = "";

        if (percent <= 25) {
          phase = "Reading your notes";
        } else if (percent <= 50) {
          phase = "Analyzing patterns";
        } else if (percent <= 75) {
          phase = "Finding connections";
        } else {
          phase = "Building relationships";
        }
        message = `Re-indexing: ${phase}... ${percent}%`;

        this.statusBarItem.setText(message);
      });

      if (this.similarityProvider.isCorpusSampled()) {
        this.statusBarItem.setText("⚠️ Using a sample of your notes");
        this.statusBarItem.setAttribute('aria-label', 'For better performance, Related Notes is using a sample of up to 10000 notes');
        this.statusBarItem.setAttribute('title', 'For better performance, Related Notes is using a sample of up to 10000 notes');
      } else {
        this.statusBarItem.setText("Ready to find related notes");
        this.statusBarItem.removeAttribute('aria-label');
        this.statusBarItem.removeAttribute('title');
      }
      this.isInitialized = true;

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
      if (error instanceof Error && error.message === 'Indexing cancelled') {
        this.statusBarItem.setText("Re-indexing cancelled");
        setTimeout(() => {
          this.statusBarItem.setText("Ready to find related notes");
        }, 2000);
        throw error; // Re-throw to be caught by the settings tab
      }
      console.error("Error during re-indexing:", error);
      this.statusBarItem.setText("Error during re-indexing");
      setTimeout(() => {
        this.statusBarItem.setText("Ready to find related notes");
      }, 2000);
    } finally {
      this.isReindexing = false;
    }
  }

  /**
   * Cancels the current re-indexing operation
   */
  public cancelReindex(): void {
    if (this.isReindexing) {
      this.reindexCancelled = true;
    }
  }

  private registerEventHandlers() {
    this.registerEvent(
      this.app.workspace.on('file-open',
        (file: TFile | null) => this.showRelatedNotes(this.app.workspace, file))
    );
  }

  private registerCommands() {
    this.addCommand({
      id: 'show-related-notes',
      name: 'Show related notes',
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.createAndInitializeView();
        }
        return true;
      }
    });
  }

  async onunload() {
    // Obsidian automatically detaches leaves when a plugin is unloaded
    // No need to manually detach leaves here
  }


  private async createAndInitializeView() {
    // Refresh the view if it's open
    const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    if (leaves.length > 0) {
      const view = leaves[0].view;
      view.containerEl.focus();
      return;
    }

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
   * Gets memory usage statistics from the similarity provider
   */
  public getMemoryStats(): MemoryStats {
    const stats = this.similarityProvider.getStatistics();

    return {
      numDocuments: stats.numDocuments || 0,
      numBands: stats.numBands || 0,
      rowsPerBand: stats.rowsPerBand || 0,
      totalBuckets: stats.totalBuckets || 0,
      maxBucketSize: stats.maxBucketSize || 0,
      avgBucketSize: stats.avgBucketSize || 0,
      cacheSize: stats.commonTermsCacheSize || 0,
      // Rough estimate of memory usage
      estimatedMemoryUsage: Math.round(
        (stats.numDocuments || 0) * 500 + // 500 bytes per document signature
        (stats.commonTermsCacheSize || 0) * 200 / 1024 // 200 bytes per cache entry
      ),
      // On-demand indexing stats
      onDemandIndexedCount: stats.onDemandIndexedCount || 0,
      totalIndexedCount: stats.totalIndexedCount || 0
    };
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

  /**
   * Gets related notes for a file, ensuring the file is indexed first if needed
   * @param file File to find related notes for
   * @returns Array of related notes
   */
  private async getRelatedNotes(file: TFile): Promise<Array<RelatedNote>> {
    // First, ensure the current file is indexed
    // This handles the case where the current file wasn't part of the initial indexing
    await this.ensureFileIsIndexed(file);
    
    // Get pre-indexed candidates
    const candidates = this.similarityProvider.getCandidateFiles(file);
    
    // Create a set of files to check for on-demand indexing
    // This ensures we don't do duplicate work
    const filesToEnsureIndexed = new Set<TFile>();
    
    // For each candidate, make sure it's indexed
    for (const candidate of candidates) {
      filesToEnsureIndexed.add(candidate);
    }
    
    // If we're in a large vault and didn't find enough candidates,
    // add a sample of other files that might not be indexed yet
    if (this.similarityProvider.isCorpusSampled() && candidates.length < this.settings.maxSuggestions) {
      // Get a small random sample of files that might not be indexed
      const additionalCandidates = this.getAdditionalCandidates(file, 10);
      for (const candidate of additionalCandidates) {
        filesToEnsureIndexed.add(candidate);
      }
    }
    
    // Ensure all candidates are indexed (in parallel)
    if (filesToEnsureIndexed.size > 0) {
      await Promise.all(
        Array.from(filesToEnsureIndexed).map(f => this.ensureFileIsIndexed(f))
      );
    }
    
    // Now get the updated list of candidates (should include newly indexed files)
    const updatedCandidates = this.similarityProvider.getCandidateFiles(file);
    
    // Calculate similarities for all candidates
    const similarityPromises = updatedCandidates.map(async (candidate) => {
      const similarity = await this.similarityProvider.computeCappedCosineSimilarity(file, candidate);
      return {
        file: candidate,
        similarity: similarity.similarity,
        commonTerms: similarity.commonTerms || [] // Pass common terms to UI
      };
    });

    const relatedNotes: RelatedNote[] = await Promise.all(similarityPromises);

    // Sort by similarity (highest first)
    const sortedNotes = relatedNotes.sort((a, b) => b.similarity - a.similarity);

    // For large corpora, return more results but with a minimum similarity threshold
    if (this.similarityProvider.isCorpusSampled()) {
      // Return up to maxSuggestions*2 notes for large corpora, but ensure they have some relevance
      const minSimilarity = this.settings.similarityThreshold / 2; // Lower threshold for large corpora
      return sortedNotes
        .filter(note => note.similarity >= minSimilarity)
        .slice(0, this.settings.maxSuggestions * 2);
    }

    // For normal corpora, take top N with standard threshold
    return sortedNotes
      .filter(note => note.similarity >= this.settings.similarityThreshold)
      .slice(0, this.settings.maxSuggestions);
  }
  
  /**
   * Ensures a file is indexed in the similarity provider
   * @param file The file to ensure is indexed
   */
  private async ensureFileIsIndexed(file: TFile): Promise<void> {
    // Skip non-markdown files
    if (!this.isMarkdownFile(file)) return;
    
    try {
      // Check if the file is already indexed
      // Using a method that uses type checking to see if the method exists
      if ('isFileIndexed' in this.similarityProvider) {
        const isIndexed = (this.similarityProvider as any).isFileIndexed(file);
        if (isIndexed) return; // Already indexed, nothing to do
      }
      
      // Update file access time to prioritize it in the future
      if ('updateFileAccessTime' in this.similarityProvider) {
        this.similarityProvider.updateFileAccessTime(file);
      }
      
      // Add the document to the index
      if ('addDocument' in this.similarityProvider && this.similarityProvider.addDocument) {
        await this.similarityProvider.addDocument(file);
      }
    } catch (error) {
      console.error(`Error ensuring file ${file.path} is indexed:`, error);
    }
  }
  
  /**
   * Gets additional candidate files that might not be indexed yet
   * This is used to expand search results in large vaults
   * @param currentFile Current file to avoid including in results
   * @param count Maximum number of additional files to include
   * @returns Array of TFile objects
   */
  private getAdditionalCandidates(currentFile: TFile, count: number): TFile[] {
    // Get all markdown files
    const allFiles = this.app.vault.getMarkdownFiles();
    
    // Filter out the current file
    const otherFiles = allFiles.filter(f => f.path !== currentFile.path);
    
    // If we have fewer files than requested, return all of them
    if (otherFiles.length <= count) return otherFiles;
    
    // Create a prioritized list based on:
    // 1. Recently accessed files (if we have access times)
    // 2. Recently modified files
    // 3. Files in the same folder as the current file
    
    // Sort by modification time (most recent first)
    otherFiles.sort((a, b) => b.stat.mtime - a.stat.mtime);
    
    // Take a mix of:
    // - Some recent files (60%)
    // - Some random files from the rest (40%)
    const recentCount = Math.ceil(count * 0.6);
    const randomCount = count - recentCount;
    
    const result: TFile[] = [];
    
    // Add recent files
    result.push(...otherFiles.slice(0, recentCount));
    
    // Add some random files from the remainder
    const remainingFiles = otherFiles.slice(recentCount);
    for (let i = 0; i < randomCount && remainingFiles.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * remainingFiles.length);
      result.push(remainingFiles[randomIndex]);
      remainingFiles.splice(randomIndex, 1);
    }
    
    return result;
  }
}
