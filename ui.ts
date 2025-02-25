/**
 * @file UI components for the Related Notes plugin.
 * Implements the view for displaying related notes.
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import RelatedNotesPlugin from './main';
import { RelatedNote } from './core';

'use strict';

export const RELATED_NOTES_VIEW_TYPE = 'related-notes-view';

export class RelatedNotesView extends ItemView {
  plugin: RelatedNotesPlugin;
  currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatedNotesPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Related Notes';
  }

  getIcon(): string {
    return 'zap';
  }

  public async onOpen() {
    if (!this.containerEl.children[1]) {
      this.containerEl.createDiv();
    }
    const container = this.containerEl.children[1];
    container.empty();
    this.containerEl.addClass('related-notes-container');
    container.createEl('h4', { text: 'Related Notes' });
    container.createDiv({ cls: 'related-notes-content' });
  }

  async onClose() {
    this.containerEl.empty();
    this.containerEl.removeClass('related-notes-container');
    this.currentFile = null;
  }

  async reset() {
    const fragment = document.createDocumentFragment();
    fragment.createEl('h4', { text: 'Related Notes' });
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
    messageEl.createEl('p', {
      text: 'Open a markdown file to see related notes.',
      cls: 'related-notes-message-text'
    });

    // Replace the old content with the new fragment.
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(fragment);
  }

  async updateForFile(file: TFile, notes: RelatedNote[]) {
    const fragment = document.createDocumentFragment();
    fragment.createEl('h4', { text: 'Related Notes' });
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    this.currentFile = file;

    // Prepare content based on file state.
    if (!this.plugin.isMarkdownFile(file)) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      messageEl.createEl('p', {
        text: 'Related notes are only available for markdown files.',
        cls: 'related-notes-message-text'
      });
      messageEl.createEl('p', {
        text: `Current file type: ${file.extension.toUpperCase()}`,
        cls: 'related-notes-message-subtext'
      });

      // Replace the old content with the new fragment
      const container = this.containerEl.children[1];
      container.empty();
      container.appendChild(fragment);
      return;
    }

    if (!notes.length) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      if (!this.plugin.isInitializationComplete()) {
        messageEl.createEl('p', {
          text: 'Still analyzing your notes...',
          cls: 'related-notes-message-text'
        });
        messageEl.createEl('p', {
          text: 'Related notes will appear here once indexing is complete.',
          cls: 'related-notes-message-subtext'
        });
      } else {
        messageEl.createEl('p', {
          text: 'No related notes found.',
          cls: 'related-notes-message-text'
        });
      }

      // Replace the old content with the new fragment
      const container = this.containerEl.children[1];
      container.empty();
      container.appendChild(fragment);
      return;
    }

    // Check if we're showing approximate matches (more than 5 notes)
    const isShowingApproximateMatches = notes.length > 5;

    if (isShowingApproximateMatches) {
      const infoEl = contentEl.createDiv({ cls: 'related-notes-info' });
      infoEl.createEl('p', {
        text: 'Showing approximate matches for your large note collection',
        cls: 'related-notes-info-text'
      });
    }

    const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });
    const listItems = notes.map(({ file: relatedFile }) => {
      const listItemEl = document.createElement('li');
      listItemEl.className = 'related-note-item';
      listItemEl.style.cursor = 'pointer';

      const linkContainer = document.createElement('div');
      linkContainer.className = 'related-note-link-container';

      const nameEl = document.createElement('span');
      nameEl.className = 'related-note-link';
      nameEl.textContent = relatedFile.basename;
      linkContainer.appendChild(nameEl);

      // No similarity indicators shown
      listItemEl.appendChild(linkContainer);

      listItemEl.addEventListener('click', async () => {
        try {
          const leaf = this.app.workspace.getLeaf();
          if (!leaf) return;
          await leaf.openFile(relatedFile);
        } catch (error) {
          console.error(`Error opening file ${relatedFile.path}:`, error);
        }
      });

      return listItemEl;
    });

    listItems.forEach(item => listEl.appendChild(item));

    // Replace the old content with the new fragment in a single operation.
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(fragment);
  }
}
