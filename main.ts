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
      this.statusBarItem.setText(`Indexing ${processed}/${total} documents...`);
    });
    this.statusBarItem.setText("Indexing complete");
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
    console.log("Showing related notes for", file, "->", relatedNotes)
    await view.updateForFile(file, relatedNotes);
  }

  private async getRelatedNotes(file: TFile): Promise<Array<RelatedNote>> {
    const candidates = this.similarityProvider.getCandidateFiles(file);
    return candidates.map((candidate: TFile) => ({
      file: candidate,
      similarity: 0.5
    }));
  }
}
