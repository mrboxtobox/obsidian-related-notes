import { Plugin, TFile, MarkdownView, WorkspaceLeaf, Workspace } from 'obsidian';
import { RelatedNote, SimilarityProvider, SimilarityProviderV2 } from './core';
import { RelatedNotesView, RELATED_NOTES_VIEW_TYPE } from './ui';

'use strict';

export default class RelatedNotesPlugin extends Plugin {
  private similarityProvider!: SimilarityProvider;
  private statusBarItem!: HTMLElement;
  private isInitialized = false;

  async onload() {
    // Register essential components immediately
    this.registerCommands();
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.setText("Initializing...");

    // Defer heavy initialization until layout is ready
    this.app.workspace.onLayoutReady(async () => {
      await this.initializePlugin();
    });
  }

  private async initializePlugin() {
    // Initialize UI components
    this.registerView(
      RELATED_NOTES_VIEW_TYPE,
      (leaf: WorkspaceLeaf) => new RelatedNotesView(leaf, this)
    );

    this.addRibbonIcon('zap', 'Toggle related notes',
      () => this.toggleRelatedNotes(this.app.workspace));

    // Register event handlers
    this.registerEventHandlers();

    // Initialize similarity provider with caching
    this.isInitialized = false;
    this.similarityProvider = new SimilarityProviderV2(this.app.vault);

    // Show initial status
    this.statusBarItem.setText("Loading related notes...");

    // Initialize with progress reporting and smooth transitions
    await this.similarityProvider.initialize((processed, total) => {
      const percentage = processed;
      let message = "";
      let phase = "";

      // Determine the current phase based on percentage
      if (percentage <= 25) {
        phase = "Reading your notes";
      } else if (percentage <= 50) {
        phase = "Analyzing patterns";
      } else if (percentage <= 75) {
        phase = "Finding connections";
      } else {
        phase = "Building relationships";
      }

      // Simple progress message with percentage
      message = `${phase}... ${percentage}%`;

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
    this.isInitialized = true;
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

  public isInitializationComplete(): boolean {
    return this.isInitialized;
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
    // Get pre-indexed candidates
    const candidates = this.similarityProvider.getCandidateFiles(file);

    // Calculate similarities for all pre-indexed candidates
    const similarityPromises = candidates.map(async (candidate) => {
      const similarity = await this.similarityProvider.computeCappedCosineSimilarity(file, candidate);
      return {
        file: candidate,
        similarity: similarity.similarity,
        commonTerms: similarity.commonTerms || [], // Pass common terms to UI
        isPreIndexed: true // Mark as pre-indexed
      };
    });

    let relatedNotes: RelatedNote[] = await Promise.all(similarityPromises);

    // Check if we should compute on-demand suggestions
    if (this.similarityProvider instanceof SimilarityProviderV2 &&
      this.similarityProvider.isCorpusSampled() &&
      this.similarityProvider.onDemandComputationEnabled) {

      // Compute on-demand suggestions if the file isn't in the priority index
      // or if we have fewer than 5 pre-indexed candidates
      const shouldComputeOnDemand =
        !this.similarityProvider.isFileIndexed(file) ||
        candidates.length < 5;

      if (shouldComputeOnDemand) {
        // Compute related notes on-demand
        const onDemandNotes = await this.similarityProvider.computeRelatedNotesOnDemand(file);

        // Add on-demand notes to the results
        relatedNotes = [
          ...relatedNotes,
          ...onDemandNotes.map(note => ({
            ...note,
            isPreIndexed: false // Mark as computed on-demand
          }))
        ];
      }
    }

    // Sort by similarity (highest first)
    const sortedNotes = relatedNotes.sort((a, b) => b.similarity - a.similarity);

    // Determine if we're dealing with a large corpus
    const isLargeCorpus = this.similarityProvider instanceof SimilarityProviderV2 &&
      this.similarityProvider.isCorpusSampled();

    // For large corpora, return more results but with a minimum similarity threshold
    if (isLargeCorpus) {
      // Return up to 10 notes for large corpora, but ensure they have some relevance
      const minSimilarity = 0.15; // Minimum similarity threshold
      return sortedNotes
        .filter(note => note.similarity >= minSimilarity)
        .slice(0, 10);
    }

    // For normal corpora, take top 5 with standard threshold
    return sortedNotes.slice(0, 5);
  }
}
