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
    return this.plugin.settings.customTitle;
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

    // Create content container
    container.createDiv({ cls: 'related-notes-content' });
  }

  async onClose() {
    this.containerEl.empty();
    this.containerEl.removeClass('related-notes-container');
    this.currentFile = null;
  }

  async reset() {
    const fragment = document.createDocumentFragment();

    // Create content container
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    
    // Add title inside content
    contentEl.createEl('h4', { text: this.plugin.settings.customTitle, cls: 'related-notes-title' });
    
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
   * Checks for existing links to avoid duplicates
   */
  private async addLink(sourceFile: TFile, targetFile: TFile): Promise<void> {
    try {
      // Get current content
      const content = await this.app.vault.cachedRead(sourceFile);

      // Check if link already exists to avoid duplicates
      const linkExists = await this.hasLink(sourceFile, targetFile);
      if (linkExists) {
        return; // Link already exists, no-op
      }

      // Create a wiki link to the target file
      const linkText = `\n\n## ${this.plugin.settings.customTitle}\n- [[${targetFile.basename}]]\n`;

      // Check if the file already has a custom title section
      const relatedSectionRegex = new RegExp(`\\n## ${this.plugin.settings.customTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`);
      let newContent: string;

      if (relatedSectionRegex.test(content)) {
        // Check if this specific link already exists in the custom title section
        const existingLinkRegex = new RegExp(`- \[\[${targetFile.basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\]\]`, 'i');
        if (existingLinkRegex.test(content)) {
          return; // Link already exists in custom title section
        }
        
        // Add to existing custom title section
        const escapedTitle = this.plugin.settings.customTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        newContent = content.replace(
          new RegExp(`\\n## ${escapedTitle}\\n((?:- \\[\\[[^\\]]+\\]\\]\\n)*)`),
          (match, p1) => `\n## ${this.plugin.settings.customTitle}\n${p1}- [[${targetFile.basename}]]\n`
        );
      } else {
        // Add new custom title section at the end
        newContent = content + linkText;
      }

      // Write the updated content back to the file
      await this.app.vault.modify(sourceFile, newContent);
    } catch (error) {
      console.error(`Error adding link to ${sourceFile.path}:`, error);
      throw error; // Re-throw so the UI can handle it
    }
  }

  async updateForFile(file: TFile, notes: RelatedNote[]) {
    const fragment = document.createDocumentFragment();

    // Create content container
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    
    // Add title inside content
    contentEl.createEl('h4', { text: this.plugin.settings.customTitle, cls: 'related-notes-title' });
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

    // Check if we're working with a large vault
    const isLargeVault = this.app.vault.getMarkdownFiles().length > 1000;

    const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });

    // Create list items for each related note
    const listItems = notes.map((note) => {
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
      nameEl.title = relatedFile.basename; // Add tooltip with full name
      linkContainer.appendChild(nameEl);

      // No on-demand indicator needed anymore

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

      // Create the action buttons container
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'related-note-actions';

      // Always show the "Link" button - we'll check for existing links when clicked
      const linkButton = document.createElement('button');
      linkButton.className = 'related-note-link-button';
      linkButton.textContent = 'Link';
      linkButton.title = 'Add a link to this note';
      linkButton.addEventListener('click', async (e) => {
        e.stopPropagation(); // Prevent opening the file
        
        // Disable button during operation
        linkButton.disabled = true;
        linkButton.textContent = 'Checking...';
        
        try {
          // Check if link already exists (only when user clicks)
          const hasLinkToRelated = await this.hasLink(file, relatedFile);
          
          if (hasLinkToRelated) {
            // Link already exists - make it a no-op
            linkButton.textContent = 'Linked';
            linkButton.classList.add('linked');
            linkButton.title = 'This note is already linked';
          } else {
            // Add the link
            await this.addLink(file, relatedFile);
            linkButton.textContent = 'Linked';
            linkButton.classList.add('linked');
            linkButton.title = 'Link added successfully';
          }
        } catch (error) {
          console.error('Error processing link:', error);
          // Re-enable button on error
          linkButton.disabled = false;
          linkButton.textContent = 'Link';
        }
      });
      actionsContainer.appendChild(linkButton);

      // Add the actions container to the item container
      itemContainer.appendChild(actionsContainer);

      // Add the item container to the list item
      listItemEl.appendChild(itemContainer);

      // Common terms section removed

      return listItemEl;
    });

    // Add all list items to the list
    listItems.forEach(item => listEl.appendChild(item));

    // Replace the old content with the new fragment in a single operation.
    const container = this.containerEl.children[1];
    container.empty();
    container.appendChild(fragment);
  }
}