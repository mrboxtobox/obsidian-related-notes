import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import { WordTokenizer, TfIdf } from './nlp';
import { Logger } from './logger';
import { RelatedNotesSettingTab } from './settings';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

interface RelatedNotesSettings {
  similarityThreshold: number;
  existingLinkWeight: number;
  contentSimilarityWeight: number;
  maxSuggestions: number;
  cacheTimeout: number;
}

const DEFAULT_SETTINGS: RelatedNotesSettings = {
  similarityThreshold: 0.0,
  existingLinkWeight: 0.4,
  contentSimilarityWeight: 0.6,
  maxSuggestions: 5,
  cacheTimeout: 300000 // 5 minutes in milliseconds
};

export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private tokenizer: WordTokenizer;
  private tfidf: TfIdf;
  private documentVectors: Map<string, number[] | undefined>;
  private processingQueue: Set<string>;
  private isPluginActive = false;  // Add this flag


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
    this.tfidf = new TfIdf();
    this.documentVectors = new Map();
    this.processingQueue = new Set();
    Logger.info('NLP components initialized');

    // Add ribbon icon
    const ribbonIconEl = this.addRibbonIcon(
      'dice',
      'Related Notes',
      async () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView && activeView.file) {
          await this.showRelatedNotes(activeView.file);
        }
      }
    );

    // Register event handlers
    this.registerEvent(
      this.app.workspace.on('file-open', async (file) => {
        if (file instanceof TFile) {
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

    // Initialize view
    if (this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE).length === 0) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
        // Wait for view to be created
        const view = leaf.view;
        if (view instanceof RelatedNotesView) {
          // Ensure view is properly initialized
          if (!view.containerEl.children[1]) {
            await view.onOpen();
          }
          Logger.info('Related notes view initialized');
        } else {
          Logger.error('Failed to initialize Related Notes view');
        }
      }
    }

    Logger.timeEnd('Plugin load');
    Logger.info('Plugin loaded successfully');
  }

  onunload() {
    Logger.info('Plugin unloading...');
    this.isPluginActive = false;
    this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async processFile(file: TFile) {
    if (this.processingQueue.has(file.path)) {
      Logger.info(`File ${file.path} is already being processed, skipping`);
      return;
    }

    Logger.time(`Process file: ${file.path}`);
    Logger.info(`Processing file: ${file.path}`);
    this.processingQueue.add(file.path);
    try {
      const content = await this.app.vault.read(file);
      Logger.info("In try block")
      Logger.info(`File content length: ${content.length} characters`);

      Logger.time('Tokenization');
      const tokens = this.tokenizer.tokenize(content.toLowerCase());
      Logger.timeEnd('Tokenization');
      Logger.info(`Tokenized into ${tokens.length} tokens`);

      // Add to TF-IDF
      Logger.time('TF-IDF processing');
      this.tfidf.addDocument(tokens);

      // Calculate TF-IDF vector
      const terms = new Set(tokens);
      Logger.info(`Unique terms: ${terms.size}`);
      const vector: number[] = [];
      terms.forEach(term => {
        const tfidfScore = this.tfidf.tfidf(term, this.tfidf.documentsList.length - 1);
        vector.push(tfidfScore);
      });
      Logger.timeEnd('TF-IDF processing');
      Logger.info(`Generated vector of length ${vector.length}`);

      // Store document vector
      this.documentVectors.set(file.path, vector);
      Logger.info(`Vector stored in memory for ${file.path}`);

      // Store vector in plugin data
      Logger.time('Vector persistence');
      const existingData = await this.loadData();
      await this.saveData({
        ...existingData,
        [`vector-${file.path}`]: vector
      });
      Logger.timeEnd('Vector persistence');
      Logger.info(`Vector persisted to disk for ${file.path}`);
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
      // Try to get vector from memory first
      let currentVector = this.documentVectors.get(file.path);
      Logger.info(`Vector in memory: ${currentVector ? 'yes' : 'no'}`);

      // If not in memory, try to get from database
      if (!currentVector) {
        Logger.info('Vector not in memory, checking persistent storage');
        try {
          const data = await this.loadData();
          const storedVector = data[`vector-${file.path}`];
          if (storedVector) {
            Logger.info('Vector found in persistent storage');
            currentVector = storedVector;
          } else {
            Logger.info('Vector not found in persistent storage');
          }
          this.documentVectors.set(file.path, currentVector);
        } catch (error) {
          Logger.warn('Error loading vector from persistent storage, reprocessing file');
          // If not found in database, process the file
          await this.processFile(file);
          currentVector = this.documentVectors.get(file.path);
        }
      }

      if (!currentVector) {
        Logger.error(`Unable to generate vector for ${file.path}`);
        return;
      }

      Logger.info(`Vector available for processing, length: ${currentVector.length}`);

      // At this point TypeScript knows currentVector is defined
      Logger.time('Find related notes');
      const relatedNotes = await this.findRelatedNotes(file, currentVector);
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
    Logger.info(`Finding related notes for ${file.path} with vector length ${currentVector.length}`);
    const similarities: Array<{ file: TFile; similarity: number }> = [];

    for (const [path, vector] of this.documentVectors.entries()) {
      if (path === file.path || !vector) continue;

      const similarity = this.calculateCosineSimilarity(currentVector, vector);
      Logger.info(`Similarity with ${path}: ${similarity}`);

      if (similarity >= this.settings.similarityThreshold) {
        const targetFile = this.app.vault.getAbstractFileByPath(path);
        if (targetFile instanceof TFile) {
          similarities.push({ file: targetFile, similarity });
          Logger.info(`Added ${path} to related notes with similarity ${similarity}`);
        }
      }
    }

    const sortedResults = similarities
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.settings.maxSuggestions);

    Logger.info(`Returning ${sortedResults.length} related notes after filtering and sorting`);
    return sortedResults;
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
