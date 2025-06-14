import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace, App } from 'obsidian';
import { RelatedNote, SimilarityProvider } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';
import { RelatedNotesSettings, DEFAULT_SETTINGS, RelatedNotesSettingTab } from './settings';
import { MultiResolutionBloomFilterProvider } from './multi-bloom';

'use strict';

export interface MemoryStats {
  vocabularySize: number;
  fileVectorsCount: number;
  signaturesCount: number;
  relatedNotesCount: number;
  onDemandCacheCount: number;
  estimatedMemoryUsage: number;
}

export interface NLPStats {
  averageShingleSize: number;
  averageDocLength: number;
  similarityProvider: string;
  lshBands: number;
  lshRowsPerBand: number;
  averageSimilarityScore: number;
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
  public id: string = 'obsidian-related-notes'; // Plugin ID for settings
  
  /**
   * Opens the plugin settings tab
   */
  public openSettings(): void {
    // Access setting via cast to handle TypeScript error
    const appWithSettings = this.app as App & { setting: { open: () => void, openTabById: (id: string) => void } };
    appWithSettings.setting.open();
    appWithSettings.setting.openTabById(this.id);
  }

  async onload() {
    // Load settings
    await this.loadSettings();

    // Register essential components immediately
    this.registerCommands();
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("Initializing...");

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
      const oldCachePath = `${configDir}/plugins/obsidian-related-notes/similarity-cache.json`;
      await this.app.vault.adapter.remove(oldCachePath).catch(() => {
        // Ignore error if file doesn't exist
      });
      console.log('Removed old similarity cache (if it existed)');
    } catch (error) {
      // Ignore errors when trying to delete old cache
    }

    // Use multi-resolution bloom filter provider
    this.similarityProvider = new MultiResolutionBloomFilterProvider(this.app.vault, {
      ngramSizes: this.settings.ngramSizes,
      bloomSizes: this.settings.bloomSizes,
      hashFunctions: this.settings.hashFunctions,
      adaptiveParameters: this.settings.adaptiveParameters,
      similarityThreshold: this.settings.similarityThreshold,
      commonWordsThreshold: this.settings.commonWordsThreshold,
      maxStopwords: this.settings.maxStopwords,
      priorityIndexSize: this.settings.priorityIndexSize,
      batchSize: this.settings.batchSize,
      onDemandComputationEnabled: this.settings.onDemandComputationEnabled
    });

    // Show initial status
    this.statusBarItem.setText("Indexing notes with bloom filter...");

    // Use setTimeout to defer heavy initialization to the next event loop
    // This prevents UI blocking during startup
    setTimeout(() => {
      this.initializeSimilarityProvider();
    }, 1000);
  }

  private async initializeSimilarityProvider() {
    // Show initial status
    this.statusBarItem.setText("Loading related notes...");

    // Initialize with progress reporting and smooth transitions
    await this.similarityProvider.initialize((processed, total) => {
      const percentage = Math.round((processed / total) * 100);
      let message = "";
      let phase = "";

      // Determine the current phase based on percentage with more concrete descriptions
      if (percentage <= 25) {
        phase = "Computing index";
      } else if (percentage <= 50) {
        phase = "Processing metadata";
      } else if (percentage <= 75) {
        phase = "Building similarity matrix";
      } else {
        phase = "Optimizing search index";
      }

      // Simple progress message with percentage
      message = `${phase}... ${percentage}%`;

      this.statusBarItem.setText(message);
    });

    // Get stats for status bar
    const stats = this.similarityProvider.getStats();
    const totalFiles = this.app.vault.getMarkdownFiles().length;
    const indexedFiles = stats.documentsIndexed || 0;
    
    // Set status bar with bloom filter info
    this.statusBarItem.setText("Bloom filter ready");
    this.statusBarItem.setAttribute('aria-label', 'Using efficient bloom filter algorithm');
    this.statusBarItem.setAttribute('title', 'Using multi-resolution bloom filter for accurate similarity calculations');
    
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

    // Check if initial indexing is still in progress
    if (!this.isInitialized) {
      this.statusBarItem.setText("Initial indexing in progress, please wait...");
      setTimeout(() => {
        this.statusBarItem.setText("Indexing in progress...");
      }, 2000);
      return;
    }

    // Set reindexing state
    this.isReindexing = true;
    this.reindexCancelled = false;

    try {
      // Update status bar
      this.isInitialized = false;
      this.statusBarItem.setText("Re-indexing notes...");

      // Force re-indexing with progress reporting
      await this.similarityProvider.forceReindex((processed, total) => {
        // Periodically yield to main thread to check for cancellation
        // This ensures the UI remains responsive and can detect cancel button clicks
        const yieldToMainAndCheckCancellation = async () => {
          // TODO(olu): Use requestAnimationFrame if available (better for UI responsiveness).
          // Fallback to setTimeout with 0ms delay
          await new Promise<void>((resolve, reject) => {
            setTimeout(() => {
              // Check if reindexing was cancelled
              if (this.reindexCancelled) {
                reject(new Error('Indexing cancelled'));
              } else {
                resolve();
              }
            }, 0);
          });
        };

        // Yield to main thread every 5% progress
        if (processed % 5 === 0) {
          yieldToMainAndCheckCancellation();
        }

        const percentage = processed;
        let message = "";
        let phase = "";

        // Determine the current phase based on percentage
        if (percentage <= 25) {
          phase = "Reading your notes";
        } else if (percentage <= 50) {
          phase = "Analyzing patterns";
        } else if (percentage <= 75) {
          phase = "Finding connections";
        } else {
          phase = "Building relationships";
        }

        // Simple progress message with percentage
        message = `Re-indexing: ${phase}... ${percentage}%`;

        this.statusBarItem.setText(message);
      });

      // Update status bar after re-indexing with detailed information
      if (this.similarityProvider instanceof SimilarityProviderV2) {
        const provider = this.similarityProvider as SimilarityProviderV2;
        
        if (provider.isCorpusSampled()) {
          // For very large vaults using sampling
          const totalFiles = this.app.vault.getMarkdownFiles().length;
          const indexedFiles = provider.getFileVectorsCount();
          const percentIndexed = Math.round((indexedFiles / totalFiles) * 100);
          
          if (this.settings.useBloomFilter) {
            // Using bloom filter with sampling
            this.statusBarItem.setText(`📊 Re-indexed with bloom filter (${percentIndexed}%)`);
            setTimeout(() => {
              this.statusBarItem.setText(`📊 Using bloom filter (${percentIndexed}% indexed)`);
            }, 3000);
            
            this.statusBarItem.setAttribute('aria-label', 
              `Bloom filter enabled: Using ${indexedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} notes`);
            this.statusBarItem.setAttribute('title', 
              `Bloom filter is optimized for large vaults. Currently using ${indexedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} notes.`);
          } else {
            // Using MinHash with sampling
            this.statusBarItem.setText(`⚠️ Re-indexed ${percentIndexed}% of notes`);
            setTimeout(() => {
              this.statusBarItem.setText(`⚠️ Using a sample of your notes (${percentIndexed}%)`);
            }, 3000);
            
            this.statusBarItem.setAttribute('aria-label', 
              `For better performance, Related Notes is using ${indexedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} notes`);
            this.statusBarItem.setAttribute('title', 
              `Your vault is large. For better performance, only ${indexedFiles.toLocaleString()} of ${totalFiles.toLocaleString()} notes are indexed. Enable bloom filter in settings for better large vault support.`);
          }
        } else if (this.settings.useBloomFilter) {
          // Using bloom filter with full indexing
          this.statusBarItem.setText("✅ Re-indexed with bloom filter");
          setTimeout(() => {
            this.statusBarItem.setText("🔍 Bloom filter ready");
          }, 3000);
          
          this.statusBarItem.setAttribute('aria-label', 'Using efficient bloom filter algorithm');
          this.statusBarItem.setAttribute('title', 'Using bloom filter algorithm for lightweight similarity calculations');
        } else {
          // Normal operation
          this.statusBarItem.setText("✅ Re-indexing complete");
          setTimeout(() => {
            this.statusBarItem.setText("Ready to find related notes");
          }, 3000);
          
          this.statusBarItem.removeAttribute('aria-label');
          this.statusBarItem.removeAttribute('title');
        }
      } else {
        // Fallback for other providers
        this.statusBarItem.setText("Re-indexing complete");
        setTimeout(() => {
          this.statusBarItem.setText("Ready to find related notes");
        }, 3000);
        
        this.statusBarItem.removeAttribute('aria-label');
        this.statusBarItem.removeAttribute('title');
      }
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
        this.statusBarItem.setText("Re-indexing cancelled");
        setTimeout(() => {
          this.statusBarItem.setText("Ready to find related notes");
        }, 2000);
        throw error; // Re-throw to be caught by the settings tab
      }
      // For other errors, log and update status bar
      console.error("Error during re-indexing:", error);
      this.statusBarItem.setText("Error during re-indexing");
      setTimeout(() => {
        this.statusBarItem.setText("Ready to find related notes");
      }, 2000);
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
    // Obsidian automatically detaches leaves when a plugin is unloaded
    // No need to manually detach leaves here
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
   * Gets memory usage statistics from the similarity provider
   */
  public getMemoryStats(): MemoryStats {
    if (!(this.similarityProvider instanceof SimilarityProviderV2)) {
      return {
        vocabularySize: 0,
        fileVectorsCount: 0,
        signaturesCount: 0,
        relatedNotesCount: 0,
        onDemandCacheCount: 0,
        estimatedMemoryUsage: 0
      };
    }

    const provider = this.similarityProvider as SimilarityProviderV2;

    // Get stats from the provider
    const vocabularySize = provider.getVocabularySize();
    const fileVectorsCount = provider.getFileVectorsCount();
    const signaturesCount = provider.getSignaturesCount();
    const relatedNotesCount = provider.getRelatedNotesCount();
    const onDemandCacheCount = provider.getOnDemandCacheCount();

    // Estimate memory usage (very rough estimate)
    // Vocabulary: ~50 bytes per term
    // File vectors: ~100 bytes per file
    // Signatures: ~100 bytes per signature
    // Related notes: ~50 bytes per entry
    // On-demand cache: ~200 bytes per entry
    const estimatedMemoryUsage = Math.round(
      (vocabularySize * 50 +
        fileVectorsCount * 100 +
        signaturesCount * 100 +
        relatedNotesCount * 50 +
        onDemandCacheCount * 200) / 1024
    );

    return {
      vocabularySize,
      fileVectorsCount,
      signaturesCount,
      relatedNotesCount,
      onDemandCacheCount,
      estimatedMemoryUsage
    };
  }

  /**
   * Gets NLP-related statistics from the similarity provider
   */
  public getNLPStats(): NLPStats {
    if (!(this.similarityProvider instanceof SimilarityProviderV2)) {
      return {
        averageShingleSize: 0,
        averageDocLength: 0,
        similarityProvider: 'unknown',
        lshBands: 0,
        lshRowsPerBand: 0,
        averageSimilarityScore: 0,
        isCorpusSampled: false,
        totalFiles: 0,
        indexedFiles: 0,
        onDemandComputations: 0
      };
    }

    const provider = this.similarityProvider as SimilarityProviderV2;

    // Get stats from the provider
    const averageShingleSize = provider.getAverageShingleSize();
    const averageDocLength = provider.getAverageDocLength();
    const lshBands = provider.getLSHBands();
    const lshRowsPerBand = provider.getLSHRowsPerBand();
    const averageSimilarityScore = provider.getAverageSimilarityScore();
    const isCorpusSampled = provider.isCorpusSampled();
    const totalFiles = this.app.vault.getMarkdownFiles().length;
    const indexedFiles = provider.getFileVectorsCount();
    const onDemandComputations = provider.getOnDemandComputationsCount();

    // Determine similarity provider type
    let similarityProviderType = 'auto';
    if (this.settings.similarityProvider !== 'auto') {
      similarityProviderType = this.settings.similarityProvider;
    } else if (this.settings.useBloomFilter) {
      similarityProviderType = 'bloomfilter';
    } else if (isCorpusSampled) {
      similarityProviderType = 'minhash';
    } else {
      similarityProviderType = 'bm25';
    }

    return {
      averageShingleSize,
      averageDocLength,
      similarityProvider: similarityProviderType,
      lshBands,
      lshRowsPerBand,
      averageSimilarityScore,
      isCorpusSampled,
      totalFiles,
      indexedFiles,
      onDemandComputations
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

  private async getRelatedNotes(file: TFile): Promise<Array<RelatedNote>> {
    // Get pre-indexed candidates
    const candidates = this.similarityProvider.getCandidateFiles(file);

    // Calculate similarities for all pre-indexed candidates
    const similarityPromises = candidates.map(async (candidate) => {
      const similarity = await this.similarityProvider.computeCappedCosineSimilarity(file, candidate);
      return {
        file: candidate,
        similarity: similarity.similarity,
        commonTerms: similarity.commonTerms || [], // Pass common terms to UI
        isPreIndexed: true // Mark as pre-indexed
      };
    });

    let relatedNotes: RelatedNote[] = await Promise.all(similarityPromises);

    // Track files we've already processed to prevent duplicates
    const processedFilePaths = new Set<string>(
      relatedNotes.map(note => note.file.path)
    );

    // Check if we should compute on-demand suggestions
    if (this.similarityProvider instanceof SimilarityProviderV2 &&
      this.similarityProvider.isCorpusSampled() &&
      this.similarityProvider.onDemandComputationEnabled) {

      // Compute on-demand suggestions if the file isn't in the priority index
      // or if we have fewer than 5 pre-indexed candidates
      const shouldComputeOnDemand =
        !this.similarityProvider.isFileIndexed(file) ||
        candidates.length < 5;

      if (shouldComputeOnDemand) {
        // Compute related notes on-demand, passing the set of already processed file paths
        // to avoid computing similarity for files we've already processed
        const onDemandNotes = await this.similarityProvider.computeRelatedNotesOnDemand(
          file,
          10, // Default limit
          processedFilePaths // Pass the set of already processed file paths
        );

        relatedNotes = [
          ...relatedNotes,
          ...onDemandNotes.map(note => ({
            ...note,
            isPreIndexed: false // Mark as computed on-demand
          }))
        ];
      }
    }

    // Sort by similarity (highest first)
    const sortedNotes = relatedNotes.sort((a, b) => b.similarity - a.similarity);

    // Determine if we're dealing with a large corpus
    const isLargeCorpus = this.similarityProvider instanceof SimilarityProviderV2 &&
      this.similarityProvider.isCorpusSampled();

    // For large corpora, return more results but with a minimum similarity threshold
    if (isLargeCorpus) {
      // Return up to maxSuggestions*2 notes for large corpora, but ensure they have some relevance
      const minSimilarity = this.settings.similarityThreshold / 2; // Lower threshold for large corpora
      return sortedNotes
        .filter(note => note.similarity >= minSimilarity)
        .slice(0, this.settings.maxSuggestions * 2);
    }

    // For normal corpora, take top N with standard threshold
    return sortedNotes.slice(0, this.settings.maxSuggestions);
  }
}