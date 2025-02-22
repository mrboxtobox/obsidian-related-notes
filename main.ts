/**
 * @file Main plugin file for the Related Notes Obsidian plugin.
 * 
 * This plugin suggests related notes using proven similarity algorithms.
 * It supports both BM25 and MinHash LSH + BM25 providers for efficient local processing.
 */

import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Logger } from './logger';
import { RelatedNotesSettingTab } from './settings';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE, BM25Provider, MinHashLSHProvider } from './core';
import { DEFAULT_CONFIG } from './config';

/**
 * Plugin settings interface defining configuration options
 */
interface RelatedNotesSettings {
  similarityThreshold: number;
  maxSuggestions: number;
  similarityProvider: 'bm25' | 'minhash-lsh';
  debugMode: boolean;
  showAdvanced: boolean;
}

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.7,
  maxSuggestions: 10,
  similarityProvider: 'bm25',
  debugMode: false,
  showAdvanced: false
};

// Threshold for automatically switching to MinHash LSH
const MINHASH_THRESHOLD = 10000; // Number of notes that triggers automatic MinHash LSH

/**
 * Main plugin class that handles initialization, event management, and core functionality
 * for finding and displaying related notes.
 */
export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private similarityProvider: BM25Provider | MinHashLSHProvider;
  private processingQueue: Set<string>;
  private isIndexInitialized = false;

  async onload() {
    const { workspace } = this.app;
    await this.loadSettings();
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.similarityProvider = this.settings.similarityProvider === 'bm25'
      ? new BM25Provider()
      : new MinHashLSHProvider();
    await this.similarityProvider.initialize();
    this.processingQueue = new Set();

    await this.initializeIndex();

    this.addRibbonIcon(
      'zap',
      'Toggle related notes',
      async () => {
        const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

        if (leaves.length > 0) {
          workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
        } else {
          const leaf = workspace.getRightLeaf(false);
          if (leaf) {
            await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
            const view = leaf.view;
            if (view instanceof RelatedNotesView) {
              if (!view.containerEl.children[1]) {
                await view.onOpen();
              }
              const activeView = workspace.getMostRecentLeaf()?.view;
              if (activeView instanceof MarkdownView && activeView.file) {
                await this.showRelatedNotes(activeView.file);
              }
            } else {
              Logger.warn('Invalid view type');
            }
            workspace.revealLeaf(leaf);
          }
        }
      }
    );

    // Register event handlers
    this.registerEvent(
      workspace.on('file-open', async (file) => {
        if (file instanceof TFile) {
          await this.processFile(file);
          await this.showRelatedNotes(file);
        }
      })
    );

    // Handle file deletions
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile) {
          await this.similarityProvider.cleanup(file.path);
        }
      })
    );

    // Handle file renames
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile) {
          await this.similarityProvider.cleanup(oldPath);
          await this.processFile(file);
        }
      })
    );

    // Handle file modifications
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile) {
          const { workspace } = this.app;
          await this.processFile(file);
          const activeView = workspace.getActiveViewOfType(MarkdownView);
          if (activeView && activeView.file && activeView.file.path === file.path) {
            await this.showRelatedNotes(file);
          }
        }
      })
    );

    // Handle file creations
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          await this.processFile(file);
        }
      })
    );

    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    this.addCommand({
      id: 'toggle-related-notes',
      name: 'Toggle related notes',
      checkCallback: (checking: boolean) => {
        if (checking) {
          return true;
        }

        const { workspace } = this.app;
        const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

        if (leaves.length > 0) {
          workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
        } else {
          this.createAndInitializeView();
        }
        return true;
      }
    });
  }

  async onunload() {
    const { workspace } = this.app;
    await this.similarityProvider.cleanup();
    workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    // Automatically select similarity provider based on vault size
    const totalNotes = this.app.vault.getMarkdownFiles().length;
    if (totalNotes >= MINHASH_THRESHOLD) {
      this.settings.similarityProvider = 'minhash-lsh';
      await this.saveSettings();
    }
  }

  async saveSettings() {
    const oldProvider = this.settings.similarityProvider;
    await this.saveData(this.settings);

    if (this.settings.similarityProvider !== oldProvider) {
      this.similarityProvider = this.settings.similarityProvider === 'bm25'
        ? new BM25Provider()
        : new MinHashLSHProvider();
      await this.similarityProvider.initialize();
      this.isIndexInitialized = false;
      await this.initializeIndex();
    }
  }

  public isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === 'md';
  }

  private async initializeIndex() {
    if (this.isIndexInitialized) return;
    const files = this.app.vault.getMarkdownFiles();

    const { batchSize, delayBetweenBatches } = DEFAULT_CONFIG.processing;
    for (let i = 0; i < files.length; i += batchSize.indexing) {
      const batch = files.slice(i, i + batchSize.indexing);
      await Promise.all(
        batch.map(file => {
          if (this.processingQueue.has(file.path)) return Promise.resolve();
          return this.processFile(file);
        })
      );

      if (i + batchSize.indexing < files.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    this.isIndexInitialized = true;
  }

  private async processFile(file: TFile) {
    if (this.processingQueue.has(file.path)) {
      return;
    }

    if (!this.isMarkdownFile(file)) {
      return;
    }
    this.processingQueue.add(file.path);

    try {
      const content = await this.app.vault.cachedRead(file);
      await this.similarityProvider.generateVector(content);
    } catch (error) {
      Logger.error(`Error processing file ${file.path}:`, error);
    } finally {
      this.processingQueue.delete(file.path);
    }
  }

  private async createAndInitializeView() {
    const { workspace } = this.app;
    const leaf = workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
      const view = leaf.view;
      if (view instanceof RelatedNotesView) {
        if (!view.containerEl.children[1]) {
          await view.onOpen();
        }
        const activeView = workspace.getMostRecentLeaf()?.view;
        if (activeView instanceof MarkdownView && activeView.file) {
          await this.showRelatedNotes(activeView.file);
        } else {
          await view.updateForFile(null, []);
        }
      }
      workspace.revealLeaf(leaf);
    }
  }

  private async showRelatedNotes(file: TFile) {
    try {
      const { workspace, vault } = this.app;
      const content = await vault.cachedRead(file);
      const vector = await this.similarityProvider.generateVector(content);
      const relatedNotes = await this.findRelatedNotes(file, vector);

      let leaf: WorkspaceLeaf = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0];
      workspace.revealLeaf(leaf);

      const view = leaf.view;
      if (!(view instanceof RelatedNotesView)) {
        Logger.error('View not properly initialized');
        return;
      }

      if (!view.containerEl.children[1]) {
        await view.onOpen();
      }
      await view.updateForFile(file, relatedNotes);
    } catch (error) {
      Logger.error(`Error showing related notes for ${file.path}:`, error);
    }
  }

  private async findRelatedNotes(file: TFile, currentVector: any): Promise<Array<{ file: TFile; similarity: number }>> {
    const similarities: Array<{ file: TFile; similarity: number }> = [];
    const allFiles = this.app.vault.getMarkdownFiles();
    const { batchSize, delayBetweenBatches } = DEFAULT_CONFIG.processing;

    // First, use LSH to find candidate files
    const candidateFiles = new Set<TFile>();
    for (let i = 0; i < allFiles.length; i += batchSize.search) {
      const batch = allFiles.slice(i, i + batchSize.search);
      await Promise.all(
        batch.map(async (otherFile) => {
          if (otherFile.path === file.path) return;

          const content = await this.app.vault.cachedRead(otherFile);
          const otherVector = await this.similarityProvider.generateVector(content);
          const lshSimilarity = this.similarityProvider.calculateSimilarity(otherVector, currentVector);

          // Use a lower threshold for LSH filtering to avoid false negatives
          if (lshSimilarity >= this.settings.similarityThreshold * 0.5) {
            candidateFiles.add(otherFile);
          }
        })
      );

      if (i + batchSize.search < allFiles.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    // Then, calculate BM25 similarity only for candidate files
    for (const candidateFile of candidateFiles) {
      const content = await this.app.vault.cachedRead(candidateFile);
      const candidateVector = await this.similarityProvider.generateVector(content);
      const similarity = this.similarityProvider.calculateSimilarity(candidateVector, currentVector);

      if (similarity >= this.settings.similarityThreshold) {
        similarities.push({ file: candidateFile, similarity });
      }
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);
  }
}
