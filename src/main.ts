import { Plugin, TFile, MarkdownView, WorkspaceLeaf } from 'obsidian';
import * as natural from 'natural';
import levelup from 'levelup';
import leveldown from 'leveldown';
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
  similarityThreshold: 0.3,
  existingLinkWeight: 0.4,
  contentSimilarityWeight: 0.6,
  maxSuggestions: 5,
  cacheTimeout: 300000 // 5 minutes in milliseconds
};

export default class RelatedNotesPlugin extends Plugin {
  settings: RelatedNotesSettings;
  private tokenizer: natural.WordTokenizer;
  private tfidf: natural.TfIdf;
  private db: levelup.LevelUp;
  private documentVectors: Map<string, number[]>;
  private processingQueue: Set<string>;

  async onload() {
    await this.loadSettings();

    // Register view type
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    // Initialize NLP components
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
    this.documentVectors = new Map();
    this.processingQueue = new Set();

    // Initialize LevelDB
    this.db = levelup(leveldown('./data'));

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
        await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE });
      }
    }
  }

  async onunload() {
    await this.db.close();
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async processFile(file: TFile) {
    if (this.processingQueue.has(file.path)) {
      return;
    }

    this.processingQueue.add(file.path);
    try {
      const content = await this.app.vault.read(file);
      const tokens = this.tokenizer.tokenize(content.toLowerCase());

      // Add to TF-IDF
      this.tfidf.addDocument(tokens);

      // Calculate TF-IDF vector
      const terms = new Set(tokens);
      const vector: number[] = [];
      terms.forEach(term => {
        const tfidfScore = this.tfidf.tfidf(term, this.tfidf.documents.length - 1);
        vector.push(tfidfScore);
      });

      // Store document vector
      this.documentVectors.set(file.path, vector);

      // Store in LevelDB for persistence
      await this.db.put(file.path, JSON.stringify(vector));
    } catch (error) {
      console.error(`Error processing file ${file.path}:`, error);
    } finally {
      this.processingQueue.delete(file.path);
    }
  }

  private async showRelatedNotes(file: TFile) {
    if (!file) return;

    const currentVector = this.documentVectors.get(file.path);
    if (!currentVector) {
      await this.processFile(file);
      return;
    }

    const relatedNotes = await this.findRelatedNotes(file, currentVector);

    // Get or create the related notes view
    let relatedView = this.app.workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE)[0]?.view as RelatedNotesView;

    if (!relatedView) {
      const leaf = this.app.workspace.getRightLeaf(false);
      if (leaf) {
        await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE });
        relatedView = leaf.view as RelatedNotesView;
      }
    }

    // Update the view with new related notes
    if (relatedView) {
      await relatedView.updateForFile(file, relatedNotes);
    }
  }

  private async findRelatedNotes(file: TFile, currentVector: number[]) {
    const similarities: Array<{ file: TFile; similarity: number }> = [];

    for (const [path, vector] of this.documentVectors.entries()) {
      if (path === file.path) continue;

      const similarity = this.calculateCosineSimilarity(currentVector, vector);
      if (similarity >= this.settings.similarityThreshold) {
        const targetFile = this.app.vault.getAbstractFileByPath(path);
        if (targetFile instanceof TFile) {
          similarities.push({ file: targetFile, similarity });
        }
      }
    }

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
