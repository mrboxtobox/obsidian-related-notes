/**
 * @file Main plugin file for the Related Notes Obsidian plugin.
 * 
 * This plugin suggests related notes using NLP techniques and hybrid similarity analysis.
 * It supports both BM25 and Hybrid (BM25 + MinHash LSH) embedding providers for local processing.
 */

import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Logger } from './logger';
import { RelatedNotesSettingTab } from './settings';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE, BM25EmbeddingProvider, HybridEmbeddingProvider } from './core';

/**
 * Plugin settings interface defining configuration options
 */
interface RelatedNotesSettings {
  similarityThreshold: number;
  maxSuggestions: number;
  embeddingProvider: 'bm25' | 'hybrid';
  debugMode: boolean;
}

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.7,
  maxSuggestions: 10,
  embeddingProvider: 'bm25',
  debugMode: true
};

/**
 * Main plugin class that handles initialization, event management, and core functionality
 * for finding and displaying related notes.
 */
export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private embeddingProvider: BM25EmbeddingProvider | HybridEmbeddingProvider;
  private processingQueue: Set<string>;
  private isPluginActive = false;
  private isInitialized = false;
  private isViewVisible = false;

  async onload() {
    Logger.info('Plugin loading...');
    Logger.time('Plugin load');
    this.isPluginActive = true;

    await this.loadSettings();
    Logger.info('Settings loaded', this.settings);

    // Register view type
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    // Initialize embedding provider
    this.embeddingProvider = this.settings.embeddingProvider === 'bm25'
      ? new BM25EmbeddingProvider()
      : new HybridEmbeddingProvider();
    await this.embeddingProvider.initialize();
    this.processingQueue = new Set();
    Logger.info('Embedding provider initialized');

    // Initialize document index
    await this.initializeIndex();

    // Add ribbon icon
    this.addRibbonIcon(
      'zap',
      'Toggle Related Notes',
      async () => {
        const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

        if (leaves.length > 0) {
          // View exists, detach it
          this.isViewVisible = false;
          this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
        } else {
          // Create new view
          this.isViewVisible = true;
          const leaf = this.app.workspace.getRightLeaf(false);
          if (leaf) {
            await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
            // Force the view to initialize even if no file is open
            const view = leaf.view;
            if (view instanceof RelatedNotesView) {
              const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
              Logger.debug(`activeView: ${activeView} | activeView.file: ${activeView?.file}`)
              if (activeView && activeView.file) {
                await this.showRelatedNotes(activeView.file);
              } else {
                await view.updateForFile(null, []);
              }
            }
          }
        }
      }
    );

    // Register event handlers
    this.registerEvent(
      this.app.workspace.on('file-open', async (file) => {
        if (file instanceof TFile) {
          await this.processFile(file);
          // Only update related notes if view is already visible
          if (this.isViewVisible) {
            await this.showRelatedNotes(file);
          }
        }
      })
    );

    // Handle file deletions
    this.registerEvent(
      this.app.vault.on('delete', async (file) => {
        if (file instanceof TFile) {
          Logger.info(`File deleted: ${file.path}`);
          await this.embeddingProvider.cleanup();
        }
      })
    );

    // Handle file renames
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile) {
          Logger.info(`File renamed from ${oldPath} to ${file.path}`);
          // Remove old path from cache
          await this.embeddingProvider.cleanup();
          // Process file with new path
          await this.processFile(file);
        }
      })
    );

    // Handle file modifications
    this.registerEvent(
      this.app.vault.on('modify', async (file) => {
        if (file instanceof TFile) {
          Logger.info(`File modified: ${file.path}`);
          // Only process if we have a cached embedding
          await this.processFile(file);
          // Update related notes if view is visible and this is the active file
          if (this.isViewVisible) {
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file && activeView.file.path === file.path) {
              await this.showRelatedNotes(file);
            }
          }
        }
      })
    );

    // Handle file creations
    this.registerEvent(
      this.app.vault.on('create', async (file) => {
        if (file instanceof TFile && file.extension === 'md') {
          Logger.info(`New markdown file created: ${file.path}`);
          await this.processFile(file);
        }
      })
    );

    // Add settings tab
    this.addSettingTab(new RelatedNotesSettingTab(this.app, this));

    // Register commands
    this.addCommand({
      id: 'find-related-notes',
      name: 'Find Related Notes',
      checkCallback: (checking: boolean) => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          if (!checking) {
            this.showRelatedNotes(activeView.file);
          }
          return true;
        }
        return false;
      }
    });

    Logger.timeEnd('Plugin load');
    Logger.info('Plugin loaded successfully');
  }

  async onunload() {
    Logger.info('Plugin unloading...');
    this.isPluginActive = false;
    this.isViewVisible = false;
    await this.embeddingProvider.cleanup();
    this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    const oldProvider = this.settings.embeddingProvider;
    await this.saveData(this.settings);

    // Check if embedding provider settings changed
    if (this.settings.embeddingProvider !== oldProvider) {
      Logger.info('Embedding provider settings changed, reinitializing...');
      this.embeddingProvider = this.settings.embeddingProvider === 'bm25'
        ? new BM25EmbeddingProvider()
        : new HybridEmbeddingProvider();
      await this.embeddingProvider.initialize();
      // Clear initialization flag to reprocess files with new provider
      this.isInitialized = false;
      await this.initializeIndex();
    }
  }

  public isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === 'md';
  }

  private async initializeIndex() {
    if (this.isInitialized) return;

    Logger.info('Initializing document index...');
    const markdownFiles = this.app.vault.getMarkdownFiles();

    for (const file of markdownFiles) {
      if (this.processingQueue.has(file.path)) continue;
      await this.processFile(file);
    }

    this.isInitialized = true;
    Logger.info('Document index initialized');
  }

  private async processFile(file: TFile) {
    if (this.processingQueue.has(file.path)) {
      Logger.info(`File ${file.path} is already being processed, skipping`);
      return;
    }

    // Skip non-markdown files
    if (!this.isMarkdownFile(file)) {
      Logger.info(`Skipping non-markdown file: ${file.path}`);
      return;
    }

    Logger.time(`Process file: ${file.path}`);
    Logger.info(`Processing file: ${file.path}`);
    this.processingQueue.add(file.path);

    try {
      const content = await this.app.vault.read(file);
      await this.embeddingProvider.generateEmbedding(content);
    } catch (error) {
      Logger.error(`Error processing file ${file.path}:`, error);
    } finally {
      this.processingQueue.delete(file.path);
      Logger.timeEnd(`Process file: ${file.path}`);
    }
  }


  private async showRelatedNotes(file: TFile) {
    if (!this.isPluginActive) {
      Logger.warn('Plugin is not active, cannot show related notes');
      return;
    }

    if (!file) {
      Logger.warn('Attempted to show related notes with no file');
      return;
    }

    Logger.time(`Show related notes: ${file.path}`);
    Logger.info(`Finding related notes for: ${file.path}`);

    try {
      const content = await this.app.vault.read(file);
      const vector = await this.embeddingProvider.generateEmbedding(content);
      const relatedNotes = await this.findRelatedNotes(file, vector);

      // Get or create the related notes view
      let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0];

      if (!leaf) {
        if (!this.isPluginActive) {
          Logger.warn('Plugin became inactive while creating view');
          return;
        }
        leaf = this.app.workspace.getRightLeaf(false);
        if (!leaf) {
          Logger.error('Could not create related notes view');
          return;
        }
        await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE });
        this.app.workspace.revealLeaf(leaf);
      } else {
        this.app.workspace.revealLeaf(leaf);
      }

      if (!this.isPluginActive) {
        Logger.warn('Plugin became inactive while setting up view');
        return;
      }

      // Ensure view is properly initialized
      if (!leaf.view) {
        await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
      }

      // Get the view after ensuring it's initialized
      const view = leaf.view;
      if (!(view instanceof RelatedNotesView)) {
        Logger.error('View is not properly initialized as RelatedNotesView');
        return;
      }

      // Check plugin is still active before updating view
      if (!this.isPluginActive) {
        Logger.warn('Plugin became inactive before updating view');
        return;
      }

      // Initialize view if needed and update with related notes
      if (!view.containerEl.children[1]) {
        await view.onOpen();
      }
      await view.updateForFile(file, relatedNotes);
      Logger.info('Related notes view updated successfully');
    } catch (error) {
      Logger.error(`Error showing related notes for ${file.path}:`, error);
    } finally {
      Logger.timeEnd(`Show related notes: ${file.path}`);
    }
  }

  private async findRelatedNotes(file: TFile, currentVector: number[]): Promise<Array<{ file: TFile; similarity: number }>> {
    const similarities: Array<{ file: TFile; similarity: number }> = [];
    const allFiles = this.app.vault.getMarkdownFiles();

    for (const otherFile of allFiles) {
      if (otherFile.path === file.path) continue;

      const content = await this.app.vault.read(otherFile);
      const otherVector = await this.embeddingProvider.generateEmbedding(content);
      const similarity = this.embeddingProvider.calculateSimilarity(currentVector, otherVector);

      if (similarity >= this.settings.similarityThreshold) {
        similarities.push({ file: otherFile, similarity });
      }
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);
  }
}
