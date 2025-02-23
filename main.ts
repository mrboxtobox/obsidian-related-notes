/**
 * @file Main plugin file for the Related Notes Obsidian plugin.
 * 
 * This plugin suggests related notes using proven similarity algorithms.
 * It uses MinHash LSH + BM25 providers for efficient local processing.
 */

import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import { RelatedNote, SimilarityProvider, SimilarityProviderV2 } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

const SEARCH_BATCH_SIZE = 3;


/**
 * Main plugin class that handles initialization, event management, and core functionality
 * for finding and displaying related notes.
 */
export default class RelatedNotesPlugin extends Plugin {
  private similarityProvider: SimilarityProvider;

  async onload() {
    console.debug("onload() called...")
    const { workspace } = this.app;
    this.addStatusBarItem()
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    const statusBarItem = this.addStatusBarItem();
    statusBarItem.setText("Indexing...")
    this.similarityProvider = new SimilarityProviderV2(this.app.vault);
    console.time("InitializeSimilarityProvider")
    await this.similarityProvider.initialize();
    console.timeEnd("InitializeSimilarityProvider")
    statusBarItem.setText("Indexed 10/10")

    this.addRibbonIcon(
      'zap',
      'Toggle related notes',
      async () => this.toggleRelatedNotes(workspace),
    );

    this.registerEvent(
      workspace.on('file-open', async (file: TFile) => this.showRelatedNotes(workspace, file))
    );

    this.addCommand({
      id: 'toggle-related-notes',
      name: 'Toggle related notes',
      checkCallback: (checking: boolean) => {
        if (!checking) {
          this.toggleRelatedNotes(workspace);
        }
        return true;
      }
    });
  }

  async onunload() {
    this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
  }

  private async toggleRelatedNotes(workspace: Workspace) {
    try {
      const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);

      if (leaves.length > 0) {
        workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
      } else {
        this.createAndInitializeView();
      }
    } catch (error) {
      console.error('Error executing toggle command:', error);
    }
  }

  private async createAndInitializeView() {
    const { workspace } = this.app;
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) {
      console.error('Failed to create new leaf');
      return;
    }

    try {
      await leaf.setViewState({ type: RELATED_NOTES_VIEW_TYPE, active: true });
      const view = leaf.view;
      // Add this check to make the type checker later on.
      if (!(view instanceof RelatedNotesView)) {
        console.error('View not properly initialized');
        return;
      }

      // Get active file if available
      const activeView = workspace.getMostRecentLeaf()?.view;
      if (activeView instanceof MarkdownView && activeView.file) {
        await this.showRelatedNotes(workspace, activeView.file);
      } else {
        await view.reset();
      }

      // Reveal leaf after content is ready
      workspace.revealLeaf(leaf);
    } catch (error) {
      console.error('Error creating view:', error);
    }
  }


  public isMarkdownFile(file: TFile): boolean {
    return file.extension.toLowerCase() === 'md';
  }

  private async showRelatedNotes(workspace: Workspace, file: TFile) {
    if (!(file instanceof TFile)) {
      return
    }
    // Skip if a leaf has not been created.
    const leaves = workspace.getLeavesOfType(RELATED_NOTES_VIEW_TYPE);
    if (leaves.length == 0) {
      console.error("Called `showRelatedNotes` before creating a view. Skipping render.")
      return;
    }

    const view = leaves[0].view
    if (!(view instanceof RelatedNotesView)) {
      console.error(`View not properly initialized: ${view.constructor.name}`);
      return;
    }

    const relatedNotes = await this.getRelatedNotes(file);
    await view.updateForFile(file, relatedNotes);
  }

  private async getRelatedNotes(file: TFile): Promise<Array<RelatedNote>> {
    console.info(`Finding related notes for: ${file.path}`);
    const notes: Array<RelatedNote> = [];

    const candidates: TFile[] = this.similarityProvider.getCandidateFiles(file);
    // We're going to trigger the computation of similarities on demand.
    // for (let i = 0; i < candidates.length; i += SEARCH_BATCH_SIZE) {
    //   const batch = candidates.slice(i, i + SEARCH_BATCH_SIZE);
    //   await Promise.all(
    //     batch.map(async (otherFile) => {
    //       if (!otherFile || !file) { return; }
    //       if (otherFile.name === file.name) { return; }

    //       const similarity = await this.similarityProvider.computeCappedCosineSimilarity(otherFile, file);
    //       if (similarity.similarity >= 0.0) {
    //         console.log("Found similar: ");
    //         console.log(otherFile.name);
    //         notes.push({
    //           file: otherFile,
    //           similarity: similarity.similarity,
    //         })
    //       }
    //     })
    //   );
    // }

    return candidates.map((c: TFile) => ({
      file: c,
      similarity: 0.5
    }));
  }
}
