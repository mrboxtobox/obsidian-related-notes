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

    // Create header with title
    const headerEl = container.createEl('div', { cls: 'related-notes-header' });
    headerEl.createEl('h4', { text: 'Related Notes' });

    container.createDiv({ cls: 'related-notes-content' });
  }

  async onClose() {
    this.containerEl.empty();
    this.containerEl.removeClass('related-notes-container');
    this.currentFile = null;
  }

  async reset() {
    const fragment = document.createDocumentFragment();

    // Create header with title
    const headerEl = fragment.createEl('div', { cls: 'related-notes-header' });
    headerEl.createEl('h4', { text: 'Related Notes' });

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

  /**
   * Checks if a link to the target file exists in the source file content
   */
  private async hasLink(sourceFile: TFile, targetFile: TFile): Promise<boolean> {
    try {
      const content = await this.app.vault.cachedRead(sourceFile);

      // Check for various link formats
      const wikiLinkPattern = new RegExp(`\\[\\[${targetFile.basename}(\\|[^\\]]*)?\\]\\]`, 'i');
      const markdownLinkPattern = new RegExp(`\\[.*?\\]\\(${targetFile.basename}\\.md\\)`, 'i');
      const fullPathPattern = new RegExp(`\\[\\[${targetFile.path.replace(/\./g, '\\.')}(\\|[^\\]]*)?\\]\\]`, 'i');

      return wikiLinkPattern.test(content) ||
        markdownLinkPattern.test(content) ||
        fullPathPattern.test(content);
    } catch (error) {
      console.error(`Error checking for links in ${sourceFile.path}:`, error);
      return false;
    }
  }

  /**
   * Adds a link to the target file at the end of the source file
   */
  private async addLink(sourceFile: TFile, targetFile: TFile): Promise<void> {
    try {
      // Get current content
      const content = await this.app.vault.cachedRead(sourceFile);

      // Create a wiki link to the target file
      const linkText = `\n\n## Related Notes\n- [[${targetFile.basename}]]\n`;

      // Check if the file already has a Related Notes section
      const relatedSectionRegex = /\n## Related Notes\n/;
      let newContent: string;

      if (relatedSectionRegex.test(content)) {
        // Add to existing Related Notes section
        newContent = content.replace(
          /\n## Related Notes\n((?:- \[\[[^\]]+\]\]\n)*)/,
          (match, p1) => `\n## Related Notes\n${p1}- [[${targetFile.basename}]]\n`
        );
      } else {
        // Add new Related Notes section at the end
        newContent = content + linkText;
      }

      // Write the updated content back to the file
      await this.app.vault.modify(sourceFile, newContent);
    } catch (error) {
      console.error(`Error adding link to ${sourceFile.path}:`, error);
    }
  }

  async updateForFile(file: TFile, notes: RelatedNote[]) {
    const fragment = document.createDocumentFragment();

    // Create header with title
    const headerEl = fragment.createEl('div', { cls: 'related-notes-header' });
    headerEl.createEl('h4', { text: 'Related Notes' });

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

    // Check if we have any on-demand computed notes
    const hasOnDemandNotes = notes.some(note => note.isPreIndexed === false || note.computedOnDemand);

    if (hasOnDemandNotes) {
      const infoEl = contentEl.createDiv({ cls: 'related-notes-info' });
      infoEl.createEl('p', {
        text: 'Some notes were computed on-the-fly for better relevance',
        cls: 'related-notes-info-text'
      });
    }

    const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });

    // Create list items for each related note
    const listItemPromises = notes.map(async (note) => {
      const { file: relatedFile } = note;
      const listItemEl = document.createElement('li');
      listItemEl.className = 'related-note-item';

      // Create the main container for the note info and actions
      const itemContainer = document.createElement('div');
      itemContainer.className = 'related-note-item-container';

      // Create the link container for the note name
      const linkContainer = document.createElement('div');
      linkContainer.className = 'related-note-link-container';

      // Create the note name element
      const nameEl = document.createElement('span');
      nameEl.className = 'related-note-link';
      nameEl.textContent = relatedFile.basename;
      linkContainer.appendChild(nameEl);

      // Add indicator for on-demand computed notes
      if (note.isPreIndexed === false || note.computedOnDemand) {
        const indicatorEl = document.createElement('span');
        indicatorEl.className = 'related-note-indicator';
        indicatorEl.textContent = '(on-demand)';
        indicatorEl.title = 'This note was computed on-the-fly';
        linkContainer.appendChild(indicatorEl);
      }

      // Add click handler to open the related file
      linkContainer.addEventListener('click', async () => {
        try {
          const leaf = this.app.workspace.getLeaf();
          if (!leaf) return;
          await leaf.openFile(relatedFile);
        } catch (error) {
          console.error(`Error opening file ${relatedFile.path}:`, error);
        }
      });

      // Add the link container to the item container
      itemContainer.appendChild(linkContainer);

      // Check if a link already exists between the current file and the related file
      const hasLinkToRelated = await this.hasLink(file, relatedFile);
      const hasLinkFromRelated = await this.hasLink(relatedFile, file);

      // Create the action buttons container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'related-note-actions';

      // Create the "Link" button if no link exists
      if (!hasLinkToRelated) {
        const linkButton = document.createElement('button');
        linkButton.className = 'related-note-link-button';
        linkButton.textContent = 'Link';
        linkButton.title = 'Add a link to this note';
        linkButton.addEventListener('click', async (e) => {
          e.stopPropagation(); // Prevent opening the file
          await this.addLink(file, relatedFile);
          // Update button state after adding the link
          linkButton.textContent = 'Linked';
          linkButton.disabled = true;
          linkButton.classList.add('linked');
        });
        actionsContainer.appendChild(linkButton);
      } else {
        // Show a disabled "Linked" button if a link already exists
        const linkedButton = document.createElement('button');
        linkedButton.className = 'related-note-link-button linked';
        linkedButton.textContent = 'Linked';
        linkedButton.disabled = true;
        linkedButton.title = 'This note is already linked';
        actionsContainer.appendChild(linkedButton);
      }

      // Add the actions container to the item container
      itemContainer.appendChild(actionsContainer);

      // Add the item container to the list item
      listItemEl.appendChild(itemContainer);

      return listItemEl;
    });

    // Wait for all list items to be created (with link checking)
    const listItems = await Promise.all(listItemPromises);

    // Add all list items to the list
    listItems.forEach(item => listEl.appendChild(item));

    // Replace the old content with the new fragment in a single operation.
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(fragment);
  }
}
