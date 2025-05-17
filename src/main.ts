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

    // Always use SimHash for better similarity detection
    this.similarityProvider = new SimHashProvider(this.app.vault, {
      simhash: {
        hashBits: 64,
        shingleSize: 2,
        useChunkIndex: true
      },
      similarityThreshold: this.settings.similarityThreshold,
      maxRelatedNotes: this.settings.maxSuggestions
    });

    this.statusBarItem.setText("Ready (indexing in background)");

    // Defer initialization to prevent UI blocking during startup
    setTimeout(() => {
      this.initializeSimilarityProvider();
    }, 1000);
  }

  private async initializeSimilarityProvider() {
    this.statusBarItem.setText("Loading related notes...");
    await this.similarityProvider.initialize((percent) => {
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
      message = `${phase}... ${percent}%`;

      this.statusBarItem.setText(message);
    });

    // Update file access times for all files to prioritize them correctly
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const file of allFiles) {
      if ('updateFileAccessTime' in this.similarityProvider) {
        this.similarityProvider.updateFileAccessTime(file);
      }
    }

    // Check if corpus is sampled (using a subset of notes)
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
      )
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

    // Calculate similarities for all candidates
    const similarityPromises = candidates.map(async (candidate) => {
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
}
