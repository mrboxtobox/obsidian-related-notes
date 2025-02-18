import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { Logger } from './logger';
import { RelatedNotesSettingTab } from './settings';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';
import { EmbeddingManager } from './embeddings/manager';

interface RelatedNotesSettings {
  similarityThreshold: number;
  maxSuggestions: number;
  embeddingProvider: 'bm25' | 'hybrid';
}

interface CachedVector {
  vector: number[];
  mtime: number;  // File modification time
}

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.0,
  maxSuggestions: 5,
  embeddingProvider: 'bm25'
};

export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private embeddingManager: EmbeddingManager;
  private processingQueue: Set<string>;
  private isPluginActive = false;
  private isInitialized = false;
  private isViewVisible = false;

  async onload() {
    Logger.info('Plugin loading...');
    Logger.time('Plugin load');
    this.isPluginActive = true;  // Set flag when plugin loads

    await this.loadSettings();
    Logger.info('Settings loaded', this.settings);

    // Register view type
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    // Initialize embedding manager
    this.embeddingManager = new EmbeddingManager(
      this.settings.embeddingProvider
    );
    await this.embeddingManager.initialize();
    this.processingQueue = new Set();
    Logger.info('Embedding manager initialized');

    // Initialize document index
    await this.initializeIndex();

    // Add ribbon icon
    const ribbonIconEl = this.addRibbonIcon(
      'dice',
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
            // Update view with current file's related notes if one is open
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView && activeView.file) {
              await this.showRelatedNotes(activeView.file);
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
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile) {
          Logger.info(`File deleted: ${file.path}`);
          this.embeddingManager.removeFromCache(file);
        }
      })
    );

    // Handle file renames
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile) {
          Logger.info(`File renamed from ${oldPath} to ${file.path}`);
          // Remove old path from cache
          this.embeddingManager.removeFromCache(file);
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
          if (this.embeddingManager.getCachedEmbedding(file)) {
            await this.processFile(file);
            // Update related notes if view is visible and this is the active file
            if (this.isViewVisible) {
              const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
              if (activeView && activeView.file && activeView.file.path === file.path) {
                await this.showRelatedNotes(file);
              }
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
    await this.embeddingManager.cleanup();
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
      await this.embeddingManager.switchProvider(
        this.settings.embeddingProvider
      );
      // Clear initialization flag to reprocess files with new provider
      this.isInitialized = false;
      await this.initializeIndex();
    }
  }

  private isTextFile(file: TFile): boolean {
    const textExtensions = ['md', 'txt', 'css', 'js', 'ts', 'jsx', 'tsx', 'html', 'json', 'yml', 'yaml'];
    const extension = file.extension.toLowerCase();
    return textExtensions.includes(extension);
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

    // Skip non-text files
    if (!this.isTextFile(file)) {
      Logger.info(`Skipping non-text file: ${file.path}`);
      return;
    }

    // Check if file needs processing by comparing with cached embedding
    const cachedEmbedding = this.embeddingManager.getCachedEmbedding(file);
    if (cachedEmbedding) {
      Logger.info(`File ${file.path} unchanged, skipping processing`);
      return;
    }

    Logger.time(`Process file: ${file.path}`);
    Logger.info(`Processing file: ${file.path}`);
    this.processingQueue.add(file.path);

    try {
      Logger.info(`Reading file content for ${file.path}`);
      const content = await this.app.vault.read(file);
      Logger.info(`File content read successfully`, {
        path: file.path,
        contentLength: content.length,
        mtime: file.stat.mtime
      });

      // Generate embedding
      Logger.time('Generate embedding');
      const vector = await this.embeddingManager.generateEmbedding(file, content);
      Logger.timeEnd('Generate embedding');
      Logger.info(`Embedding generated successfully`, {
        path: file.path,
        vectorLength: vector.length,
        nonZeroElements: vector.filter(v => v !== 0).length
      });

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
      // Try to get vector from cache or generate new one
      let vector = this.embeddingManager.getCachedEmbedding(file);
      if (!vector) {
        const content = await this.app.vault.read(file);
        vector = await this.embeddingManager.generateEmbedding(file, content);
      }

      Logger.info(`Vector available for processing, length: ${vector.length}`);

      Logger.time('Find related notes');
      const relatedNotes = await this.findRelatedNotes(file, vector);
      Logger.timeEnd('Find related notes');
      Logger.info(`Found ${relatedNotes.length} related notes`);

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
    Logger.info(`Finding content-based related notes for ${file.path}`);
    const similarities: Array<{ file: TFile; similarity: number }> = [];

    // Process all files to find related ones
    const allFiles = this.app.vault.getMarkdownFiles();
    for (const otherFile of allFiles) {
      if (otherFile.path === file.path) continue;

      let otherVector = this.embeddingManager.getCachedEmbedding(otherFile);
      if (!otherVector) {
        const content = await this.app.vault.read(otherFile);
        otherVector = await this.embeddingManager.generateEmbedding(otherFile, content);
      }

      const similarity = this.embeddingManager.calculateSimilarity(currentVector, otherVector);

      // Only consider files that meet the threshold
      if (similarity >= this.settings.similarityThreshold) {
        similarities.push({ file: otherFile, similarity });
      }
    }

    // Sort by similarity and limit to max suggestions
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);
  }
}
