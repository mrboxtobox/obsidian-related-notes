/**
 * @file Main plugin file for the Related Notes Obsidian plugin.
 * 
 * This plugin suggests related notes using proven similarity algorithms.
 * It uses MinHash LSH + BM25 providers for efficient local processing.
 */

import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Logger, LogLevel } from './utils';
import { RelatedNotesSettingTab, RelatedNotesSettings, DEFAULT_CONFIG } from './settings';
import { SimilarityProvider, SimilarityProviderV2 } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.0,
  maxSuggestions: 10,
  debugMode: true,
  showAdvanced: false,
  logLevel: 'debug',
};

/**
 * Main plugin class that handles initialization, event management, and core functionality
 * for finding and displaying related notes.
 */
export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private similarityProvider: SimilarityProvider;
  private processingQueue: Set<string>;
  private isIndexInitialized = false;

  async onload() {
    const { workspace } = this.app;
    await this.loadSettings();
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.similarityProvider = new SimilarityProviderV2(this.app.vault);
    await this.similarityProvider.initialize();
    this.processingQueue = new Set();

    await this.initializeIndex();

    this.addRibbonIcon(
      'zap',
      'Toggle related notes',
      async () => {
        try {
          const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

          if (leaves.length > 0) {
            workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
            return;
          }

          const newLeaf = workspace.getRightLeaf(false);
          if (!newLeaf) {
            Logger.error('Failed to create new leaf');
            return;
          }

          await newLeaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
          const view = newLeaf.view;
          if (!(view instanceof RelatedNotesView)) {
            Logger.error('View not properly initialized');
            return;
          }

          // Initialize view if needed
          if (!view.containerEl.children[1]) {
            await view.onOpen();
          }

          // Get active file if available
          const activeView = workspace.getMostRecentLeaf()?.view;
          if (activeView instanceof MarkdownView && activeView.file) {
            await this.showRelatedNotes(activeView.file);
          } else {
            await view.updateForFile(null, []);
          }

          // Reveal leaf after content is ready
          workspace.revealLeaf(newLeaf);
        } catch (error) {
          Logger.error('Error toggling related notes:', error);
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

        try {
          const { workspace } = this.app;
          const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

          if (leaves.length > 0) {
            workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
          } else {
            this.createAndInitializeView();
          }
        } catch (error) {
          Logger.error('Error executing toggle command:', error);
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

    // Set log level based on settings
    const logLevelMap: Record<RelatedNotesSettings['logLevel'], LogLevel> = {
      'error': LogLevel.ERROR,
      'warn': LogLevel.WARN,
      'info': LogLevel.INFO,
      'debug': LogLevel.DEBUG
    };
    Logger.setLogLevel(logLevelMap[this.settings.logLevel]);
  }

  async saveSettings() {
    const oldLogLevel = this.settings.logLevel;
    await this.saveData(this.settings);

    // Update log level if changed
    if (oldLogLevel !== this.settings.logLevel) {
      const logLevelMap: Record<RelatedNotesSettings['logLevel'], LogLevel> = {
        'error': LogLevel.ERROR,
        'warn': LogLevel.WARN,
        'info': LogLevel.INFO,
        'debug': LogLevel.DEBUG
      };
      Logger.setLogLevel(logLevelMap[this.settings.logLevel]);
      Logger.info('Log level changed to: ' + this.settings.logLevel);
    }
  }

  public isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === 'md';
  }

  private async initializeIndex() {
    // Skip if pane is not visible or already initialized
    if (this.isIndexInitialized || !this.isRelatedNotesVisible()) {
      Logger.debug('Skipping index initialization - already initialized or pane not visible');
      return;
    }

    const files = this.app.vault.getMarkdownFiles();
    Logger.info(`Initializing index with ${files.length} files`);

    // Show loading state in view if it exists
    const view = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0]?.view;
    if (view instanceof RelatedNotesView) {
      await view.updateForFile(null, [], true);
    }

    const { batchSize, delayBetweenBatches } = DEFAULT_CONFIG.processing;
    for (let i = 0; i < files.length; i += batchSize.indexing) {
      // Check if pane is still visible before processing each batch
      if (!this.isRelatedNotesVisible()) {
        return;
      }

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

    // Remove loading state
    if (view instanceof RelatedNotesView) {
      await view.updateForFile(null, [], false);
    }
  }

  private isRelatedNotesVisible(): boolean {
    const leaves = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    return leaves.length > 0;
  }

  private async processFile(file: TFile) {
    // Skip if pane is not visible or file is already being processed
    if (!this.isRelatedNotesVisible() || this.processingQueue.has(file.path)) {
      Logger.debug(`Skipping file processing for ${file.path} - pane not visible or already processing`);
      return;
    }

    if (!this.isMarkdownFile(file)) {
      Logger.debug(`Skipping non-markdown file: ${file.path}`);
      return;
    }
    this.processingQueue.add(file.path);
    Logger.debug(`Processing file: ${file.path}`);

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
    const newLeaf = workspace.getRightLeaf(false);
    if (!newLeaf) {
      Logger.error('Failed to create new leaf');
      return;
    }

    try {
      await newLeaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
      const view = newLeaf.view;
      if (!(view instanceof RelatedNotesView)) {
        Logger.error('View not properly initialized');
        return;
      }

      // Initialize view if needed
      if (!view.containerEl.children[1]) {
        await view.onOpen();
      }

      // Get active file if available
      const activeView = workspace.getMostRecentLeaf()?.view;
      if (activeView instanceof MarkdownView && activeView.file) {
        await this.showRelatedNotes(activeView.file);
      } else {
        await view.updateForFile(null, []);
      }

      // Reveal leaf after content is ready
      workspace.revealLeaf(newLeaf);
    } catch (error) {
      Logger.error('Error creating view:', error);
    }
  }

  private async showRelatedNotes(file: TFile) {
    // Skip if pane is not visible
    if (!this.isRelatedNotesVisible()) {
      return;
    }

    try {
      const { workspace, vault } = this.app;

      // Get or create the leaf first
      let leaf = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0];
      if (!leaf) {
        const newLeaf = workspace.getRightLeaf(false);
        if (!newLeaf) {
          Logger.error('Failed to create new leaf');
          return;
        }
        await newLeaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
        leaf = newLeaf;
      }

      if (leaf === null || leaf === undefined) {
        Logger.error(`Leaf not properly initialized:`);
        return;
      }

      // Ensure view is properly initialized
      const view = leaf.view;
      if (!(view instanceof RelatedNotesView)) {
        Logger.error(`View not properly initialized: ${view.constructor.name}`);
        return;
      }

      // Initialize view if needed
      if (!view.containerEl.children[1]) {
        await view.onOpen();
      }

      // Generate content and find related notes
      const content = await vault.cachedRead(file);
      const vector = await this.similarityProvider.generateVector(content);
      const relatedNotes = await this.findRelatedNotes(file, vector);

      // Update view with new content
      await view.updateForFile(file, relatedNotes);

      // Reveal leaf after content is ready
      workspace.revealLeaf(leaf);
    } catch (error) {
      Logger.error(`Error showing related notes for ${file.path}:`, error);
    }
  }

  private async findRelatedNotes(file: TFile, currentVector: any): Promise<Array<{ file: TFile; similarity: number; topWords: string[] }>> {
    Logger.info(`Finding related notes for: ${file.path}`);
    const similarities: Array<{ file: TFile; similarity: number; topWords: string[] }> = [];
    const allFiles = this.app.vault.getMarkdownFiles();
    const { batchSize, delayBetweenBatches } = DEFAULT_CONFIG.processing;
    Logger.debug(`Using batch size: ${batchSize.search}, delay: ${delayBetweenBatches}ms`);

    // First, use LSH to find candidate files
    const candidateFiles: TFile[] = [];
    for (let i = 0; i < allFiles.length; i += batchSize.search) {
      const batch = allFiles.slice(i, i + batchSize.search);
      await Promise.all(
        batch.map(async (otherFile) => {
          if (otherFile.path === file.path) return;

          const content = await this.app.vault.cachedRead(otherFile);
          const otherVector = await this.similarityProvider.generateVector(content);
          const similarity = await this.similarityProvider.calculateSimilarity(otherFile.name, file.name);

          // Use a lower threshold for LSH filtering to avoid false negatives
          if (similarity.similarity >= this.settings.similarityThreshold * 0.5) {
            candidateFiles.push(otherFile);
            similarities.push({
              file: otherFile,
              similarity: similarity.similarity,
              topWords: similarity.topWords,
            })
          }
        })
      );
    }

    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);
  }
}
