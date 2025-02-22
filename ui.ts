/**
 * @file UI components for the Related Notes plugin.
 * Implements the view for displaying related notes.
 */

import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import RelatedNotesPlugin from './main';
import { Logger } from './utils';

// UI Components
export const RELATED_NOTES_VIEW_TYPE = 'related-notes-view';

/**
 * View component that displays related notes in a side panel.
 * Handles rendering of related notes and provides interaction capabilities like adding links.
 */
export class RelatedNotesView extends ItemView {
  plugin: RelatedNotesPlugin;
  currentFile: TFile | null = null;
  private progressBar: HTMLElement | null = null;

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

  private setLoading(loading: boolean, progress?: number) {
    const container = this.containerEl.children[1];
    if (!container) return;

    const existingLoader = container.querySelector('.related-notes-loading');
    const existingProgress = document.querySelector('.related-notes-progress');

    if (loading) {
      if (!existingLoader) {
        const loader = container.createDiv({ cls: 'related-notes-loading' });
        loader.textContent = 'Indexing notes...';
      }

      if (!existingProgress) {
        const progressContainer = document.body.createDiv({ cls: 'related-notes-progress' });
        this.progressBar = progressContainer.createDiv({ cls: 'related-notes-progress-bar' });
      }

      if (progress !== undefined && this.progressBar) {
        this.progressBar.style.width = `${progress * 100}%`;
      }
    } else {
      existingLoader?.remove();
      existingProgress?.remove();
      this.progressBar = null;
    }
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

  public async onClose() {
    this.containerEl.empty();
    this.containerEl.removeClass('related-notes-container');
    this.currentFile = null;
  }

  private hasExistingLink(content: string, targetBasename: string): boolean {
    // Check for links in the entire document
    if (content.includes(`[[${targetBasename}]]`)) {
      return true;
    }

    // Also check in the Related Notes section for backward compatibility
    const relatedSectionRegex = /\n## Related Notes\n([\s\S]*?)(\n#|$)/;
    const match = content.match(relatedSectionRegex);
    return match ? match[1].includes(`[[${targetBasename}]]`) : false;
  }

  public async updateForFile(file: TFile | null, relatedNotes: Array<{ file: TFile; similarity: number; topWords: string[] }>, isIndexing?: boolean) {
    const fragment = document.createDocumentFragment();
    const contentEl = fragment.createEl('div', { cls: 'related-notes-content' });
    this.currentFile = file;

    // Update status bar
    if (isIndexing) {
      const statusBarItem = this.containerEl.createEl('div', { cls: 'status-bar-item' });
      statusBarItem.setText('Indexing notes...');
    }

    this.setLoading(isIndexing || false);

    // Prepare content based on file state
    if (!file) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      messageEl.createEl('p', {
        text: 'Open a markdown file to see related notes.',
        cls: 'related-notes-message-text'
      });
    } else if (!this.plugin.isMarkdownFile(file)) {
      const messageEl = contentEl.createDiv({ cls: 'related-notes-message' });
      messageEl.createEl('p', {
        text: 'Related notes are only available for markdown files.',
        cls: 'related-notes-message-text'
      });
      messageEl.createEl('p', {
        text: `Current file type: ${file.extension.toUpperCase()}`,
        cls: 'related-notes-message-subtext'
      });
    } else if (!relatedNotes.length) {
      contentEl.createEl('p', { text: 'No related notes found.' });
    } else {
      const listEl = contentEl.createEl('ul', { cls: 'related-notes-list' });
      const currentContent = await this.app.vault.cachedRead(file);

      const listItems = await Promise.all(relatedNotes.map(async ({ file: relatedFile, similarity, topWords }) => {
        const listItemEl = document.createElement('li');
        listItemEl.className = 'related-note-item';

        const linkContainer = document.createElement('div');
        linkContainer.className = 'related-note-link-container';

        // Create title link
        const linkEl = document.createElement('a');
        linkEl.className = 'related-note-link';
        linkEl.textContent = relatedFile.basename;
        linkContainer.appendChild(linkEl);

        if (this.plugin.settings.debugMode) {
          const similaritySpan = document.createElement('span');
          similaritySpan.className = 'related-note-similarity';
          similaritySpan.textContent = ` (${(similarity * 100).toFixed(2)}%)`;
          linkContainer.appendChild(similaritySpan);
        }

        listItemEl.appendChild(linkContainer);

        // Add hashtags if available
        if (topWords && topWords.length > 0) {
          const hashtagsContainer = document.createElement('div');
          hashtagsContainer.className = 'related-note-hashtags';

          topWords.forEach(word => {
            const hashtag = document.createElement('span');
            hashtag.className = 'related-note-hashtag';
            hashtag.textContent = `#${word}`;
            hashtagsContainer.appendChild(hashtag);
          });

          listItemEl.appendChild(hashtagsContainer);
        }

        // Add event listener for link click
        linkEl.addEventListener('click', async (e) => {
          e.preventDefault();
          try {
            const leaf = this.app.workspace.getLeaf();
            if (!leaf) {
              Logger.error('Failed to get workspace leaf');
              return;
            }
            await leaf.openFile(relatedFile);
          } catch (error) {
            Logger.error(`Error opening file ${relatedFile.path}:`, error);
          }
        });

        return listItemEl;
      }));

      // Append all items to the list at once
      listItems.forEach(item => listEl.appendChild(item));
    }

    // Replace the old content with the new fragment in a single operation
    const container = this.containerEl.children[1] || this.containerEl.createDiv();
    container.empty();
    container.appendChild(fragment);
  }
}
