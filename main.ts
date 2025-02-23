import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import { RelatedNote, SimilarityProvider, SimilarityProviderV2 } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

'use strict';

export default class RelatedNotesPlugin extends Plugin {
  private similarityProvider!: SimilarityProvider;
  private statusBarItem!: HTMLElement;

  async onload() {
    this.initializeUI();
    await this.initializeSimilarityProvider();
    this.registerEventHandlers();
    this.registerCommands();
  }

  private initializeUI() {
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("Indexing...");

    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.addRibbonIcon('zap', 'Toggle related notes',
      () => this.toggleRelatedNotes(this.app.workspace));
  }

  private async initializeSimilarityProvider() {
    this.similarityProvider = new SimilarityProviderV2(this.app.vault);
    await this.similarityProvider.initialize((processed, total) => {
      const percentage = processed;
      let message = "";

      if (percentage <= 25) {
        message = `Reading your notes... ${percentage}%`;
      } else if (percentage <= 50) {
        message = `Analyzing patterns... ${percentage}%`;
      } else if (percentage <= 75) {
        message = `Finding connections... ${percentage}%`;
      } else {
        message = `Building relationships... ${percentage}%`;
      }

      this.statusBarItem.setText(message);
    });

    if (this.similarityProvider instanceof SimilarityProviderV2 && this.similarityProvider.isCorpusSampled()) {
      this.statusBarItem.setText("⚠️ Using a sample of your notes");
      this.statusBarItem.setAttribute('aria-label', 'For better performance, Related Notes is using a sample of up to 5000 notes');
      this.statusBarItem.setAttribute('title', 'For better performance, Related Notes is using a sample of up to 5000 notes');
    } else {
      this.statusBarItem.setText("Ready to find related notes");
      this.statusBarItem.removeAttribute('aria-label');
      this.statusBarItem.removeAttribute('title');
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
    this.app.workspace.detachLeavesOfType(RELATED_NOTES_VIEW_TYPE);
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
    const candidates = this.similarityProvider.getCandidateFiles(file);

    // Calculate similarities for all candidates.
    const similarityPromises = candidates.map(async (candidate) => {
      const similarity = await this.similarityProvider.computeCappedCosineSimilarity(file, candidate);
      return {
        file: candidate,
        similarity: similarity.similarity
      };
    });

    const relatedNotes = await Promise.all(similarityPromises);

    // Sort by similarity (highest first) and take top 5
    return relatedNotes
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }
}
