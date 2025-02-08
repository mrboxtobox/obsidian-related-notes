import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { WordTokenizer, BM25 } from './nlp';
import { Logger } from './logger';
import { RelatedNotesSettingTab } from './settings';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

interface RelatedNotesSettings {
  similarityThreshold: number;
  maxSuggestions: number;
}

interface CachedVector {
  vector: number[];
  mtime: number;  // File modification time
}

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.0,
  maxSuggestions: 5
};

export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private tokenizer: WordTokenizer;
  private bm25: BM25;
  private documentVectors: Map<string, CachedVector>;
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

    // Initialize NLP components
    this.tokenizer = new WordTokenizer();
    this.bm25 = new BM25();
    this.documentVectors = new Map();
    this.processingQueue = new Set();
    Logger.info('NLP components initialized');

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
          this.bm25.removeDocument(file.path);
          this.documentVectors.delete(file.path);
        }
      })
    );

    // Handle file renames
    this.registerEvent(
      this.app.vault.on('rename', async (file, oldPath) => {
        if (file instanceof TFile) {
          Logger.info(`File renamed from ${oldPath} to ${file.path}`);
          // Remove old path from indices
          this.bm25.removeDocument(oldPath);
          this.documentVectors.delete(oldPath);
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
          // Only process if the file is already in our index
          if (this.bm25.hasDocument(file.path)) {
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

  onunload() {
    Logger.info('Plugin unloading...');
    this.isPluginActive = false;
    this.isViewVisible = false;
    this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
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

      try {
        const content = await this.app.vault.read(file);
        const tokens = this.tokenizer.tokenize(content.toLowerCase());

        // Add to BM25 index
        this.bm25.addDocument(file.path, tokens, file.stat.mtime);

        // Calculate and cache vector
        const vector = this.bm25.calculateVector(file.path);
        if (vector) {
          const cachedVector: CachedVector = {
            vector,
            mtime: file.stat.mtime
          };
          this.documentVectors.set(file.path, cachedVector);
          Logger.info(`Vector calculated and cached during initialization: ${file.path}`);
        } else {
          Logger.error(`Failed to calculate vector during initialization: ${file.path}`);
        }
      } catch (error) {
        Logger.error(`Error processing file during initialization: ${file.path}`, error);
      }
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

    // Check if file needs processing
    const currentMtime = this.bm25.getDocumentMtime(file.path);
    if (currentMtime === file.stat.mtime) {
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

      Logger.time('Tokenization');
      const tokens = this.tokenizer.tokenize(content.toLowerCase());
      Logger.timeEnd('Tokenization');
      Logger.info(`Tokenization complete`, {
        path: file.path,
        tokenCount: tokens.length,
        sampleTokens: tokens.slice(0, 5)
      });

      // Add/Update document in BM25
      Logger.time('BM25 processing');
      Logger.info(`Adding document to BM25 index`, {
        path: file.path,
        tokenCount: tokens.length,
        mtime: file.stat.mtime
      });

      this.bm25.addDocument(file.path, tokens, file.stat.mtime);
      Logger.info(`Document added to BM25 index`, {
        path: file.path,
        isInIndex: this.bm25.hasDocument(file.path)
      });

      // Calculate and cache vector
      Logger.info(`Calculating vector for ${file.path}`);
      const vector = this.bm25.calculateVector(file.path);

      if (vector) {
        Logger.info(`Vector calculated successfully`, {
          path: file.path,
          vectorLength: vector.length,
          nonZeroElements: vector.filter(v => v !== 0).length
        });

        const cachedVector: CachedVector = {
          vector,
          mtime: file.stat.mtime
        };
        this.documentVectors.set(file.path, cachedVector);
        Logger.info(`Vector stored in memory`, {
          path: file.path,
          inCache: this.documentVectors.has(file.path)
        });
      } else {
        Logger.error(`Failed to calculate vector for ${file.path}`);
      }
      Logger.timeEnd('BM25 processing');

    } catch (error) {
      Logger.error(`Error processing file ${file.path}:`, error);
    } finally {
      this.processingQueue.delete(file.path);
      Logger.timeEnd(`Process file: ${file.path}`);
    }
  }

  private isCacheValid(cachedVector: CachedVector, file: TFile): boolean {
    return cachedVector.mtime === file.stat.mtime;
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
      // Try to get vector from memory first
      let cachedVector = this.documentVectors.get(file.path);
      Logger.info(`Vector in memory: ${cachedVector ? 'yes' : 'no'}`);

      // Check if we need to refresh the cache
      if (cachedVector && !this.isCacheValid(cachedVector, file)) {
        Logger.info('Cache invalid, clearing');
        cachedVector = undefined;
        this.documentVectors.delete(file.path);
      }

      // If vector not in memory or invalid, process the file
      if (!cachedVector) {
        await this.processFile(file);
        cachedVector = this.documentVectors.get(file.path);
      }

      if (!cachedVector) {
        Logger.error(`Unable to generate vector for ${file.path}`);
        return;
      }

      Logger.info(`Vector available for processing, length: ${cachedVector.vector.length}`);

      // At this point TypeScript knows cachedVector is defined
      Logger.time('Find related notes');
      const relatedNotes = await this.findRelatedNotes(file, cachedVector.vector);
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

    // Get all document vectors except current file
    for (const [path, cachedVector] of this.documentVectors.entries()) {
      if (path === file.path || !cachedVector) continue;

      // Calculate pure content-based similarity using BM25 vectors
      const similarity = this.calculateCosineSimilarity(currentVector, cachedVector.vector);

      // Only consider files that meet the threshold
      if (similarity >= this.settings.similarityThreshold) {
        const targetFile = this.app.vault.getAbstractFileByPath(path);
        if (targetFile instanceof TFile) {
          similarities.push({ file: targetFile, similarity });
        }
      }
    }

    // Sort by similarity and limit to max suggestions
    return similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);
  }

  private calculateCosineSimilarity(vec1: number[], vec2: number[]): number {
    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      dotProduct += vec1[i] * (vec2[i] || 0);
      norm1 += vec1[i] * vec1[i];
      norm2 += (vec2[i] || 0) * (vec2[i] || 0);
    }

    if (norm1 === 0 || norm2 === 0) return 0;
    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }
}
