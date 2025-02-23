/**
 * @file UI components for the Related Notes plugin.
 * Implements the view for displaying related notes.
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import RelatedNotesPlugin from './main';
import { RelatedNote } from './core';

export const RELATED_NOTES_VIEW_TYPE = 'related-notes-view';

/**
 * View component that displays related notes in a side panel.
 * Handles rendering of related notes and provides interaction capabilities like adding links.
 */
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
    } else if (!notes.length) {
      contentEl.createEl('p', { text: 'No related notes found.' });
    } else {
      const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });

      const listItems = await Promise.all(notes.map(async ({ file, similarity }) => {
        console.log("file", file);
        const listItemEl = document.createElement('li');
        listItemEl.className = 'related-note-item';

        const linkContainer = document.createElement('div');
        linkContainer.className = 'related-note-link-container';

        // Create title link.
        const linkEl = document.createElement('a');
        linkEl.className = 'related-note-link';
        linkEl.textContent = file.basename;
        linkContainer.appendChild(linkEl);
        listItemEl.appendChild(linkContainer);

        // Add event listener for link click.
        linkEl.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            const leaf = this.app.workspace.getLeaf();
            if (!leaf) {
              console.error('Failed to get workspace leaf');
              return;
            }
            await leaf.openFile(file);
          } catch (error) {
            console.error(`Error opening file ${file.path}:`, error);
          }
        });

        return listItemEl;
      }));

      // Append all items to the list at once.
      listItems.forEach(item => listEl.appendChild(item));
    }

    // Replace the old content with the new fragment in a single operation.
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(fragment);
  }
}
