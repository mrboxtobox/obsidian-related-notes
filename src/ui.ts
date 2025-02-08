import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import RelatedNotesPlugin from './main';
import { Logger } from './logger';

export const RELATED_NOTES_VIEW_TYPE = 'related-notes-view';

export class RelatedNotesView extends ItemView {
  plugin: RelatedNotesPlugin;
  currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: RelatedNotesPlugin) {
    super(leaf);
    this.plugin = plugin;
    Logger.info('Related Notes view initialized');
  }

  getViewType(): string {
    return RELATED_NOTES_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Related Notes';
  }

  async onOpen() {
    Logger.info('Opening Related Notes view');

    // Ensure container exists and is empty
    if (!this.containerEl.children[1]) {
      this.containerEl.createDiv();
    }
    const container = this.containerEl.children[1];
    container.empty();

    // Add base container class
    this.containerEl.addClass('related-notes-container');

    // Create header
    container.createEl('h4', { text: 'Related Notes' });

    // Create content container with class
    const contentEl = container.createDiv({ cls: 'related-notes-content' });

    Logger.info('Related Notes view DOM structure initialized');
  }

  private hasExistingLink(content: string, targetBasename: string): boolean {
    const relatedSectionRegex = /\n## Related Notes\n([\s\S]*?)(\n#|$)/;
    const match = content.match(relatedSectionRegex);
    if (match) {
      return match[1].includes(`[[${targetBasename}]]`);
    }
    return false;
  }

  async updateForFile(file: TFile | null, relatedNotes: Array<{ file: TFile; similarity: number }>) {
    Logger.info('Updating view for file:', file?.path);

    // Ensure view is properly initialized
    if (!this.containerEl.children[1]) {
      Logger.info('Container not initialized, initializing view');
      await this.onOpen();
    }

    const container = this.containerEl.children[1];
    let contentEl = container.querySelector('.related-notes-content');

    // If content element doesn't exist, reinitialize the view
    if (!contentEl) {
      Logger.info('Content element not found, reinitializing view');
      await this.onOpen();
      contentEl = container.querySelector('.related-notes-content');

      if (!contentEl) {
        Logger.error('Failed to initialize view content element');
        return;
      }
    }

    contentEl.empty();
    this.currentFile = file;

    if (!file || !relatedNotes.length) {
      Logger.info('No related notes to display');
      contentEl.createEl('p', { text: 'No related notes found.' });
      return;
    }

    Logger.info('Displaying related notes', {
      sourceFile: file.path,
      relatedCount: relatedNotes.length
    });

    // Create list of related notes
    const listEl = contentEl.createEl('ul');
    listEl.addClass('related-notes-list');

    // Get current file content to check for existing links
    const currentContent = await this.app.vault.read(file);

    for (const { file: relatedFile } of relatedNotes) {
      const listItemEl = listEl.createEl('li');
      listItemEl.addClass('related-note-item');

      // Create link to the related note
      const linkEl = listItemEl.createEl('a', {
        text: relatedFile.basename,
        cls: 'related-note-link'
      });

      // Add click handler
      linkEl.addEventListener('click', async (e) => {
        e.preventDefault();
        Logger.info('Related note link clicked:', relatedFile.path);
        await this.app.workspace.getLeaf().openFile(relatedFile);
      });

      // Check if link already exists
      const hasLink = this.hasExistingLink(currentContent, relatedFile.basename);

      // Add "Add Link" button with appropriate state
      const addLinkButton = listItemEl.createEl('button', {
        text: hasLink ? 'Linked' : 'Add Link',
        cls: hasLink ? 'related-note-linked' : 'related-note-add-link'
      });

      if (!hasLink) {
        addLinkButton.addEventListener('click', async () => {
          if (!this.currentFile) {
            Logger.warn('No current file when attempting to add link');
            return;
          }

          const activeLeaf = this.app.workspace.getLeaf(false);
          if (!activeLeaf) {
            Logger.warn('No active leaf found when attempting to add link');
            return;
          }

          // Ensure the current file is open and active
          await activeLeaf.openFile(this.currentFile);
          const activeView = activeLeaf.view;

          if (!(activeView instanceof MarkdownView)) {
            Logger.warn('Active view is not a markdown view');
            return;
          }

          Logger.info('Adding link to note:', relatedFile.path);
          const editor = activeView.editor;
          const content = editor.getValue();

          // Find or create the Related Notes section at the bottom
          const relatedSectionRegex = /\n## Related Notes\n([\s\S]*?)(\n#|$)/;
          let newContent: string;

          const match = content.match(relatedSectionRegex);
          if (match) {
            // Section exists, append link if it doesn't already exist
            const existingLinks = match[1];

            // Check if link already exists
            if (!existingLinks.includes(`[[${relatedFile.basename}]]`)) {
              // Replace the section with existing links plus new link
              newContent = content.replace(
                relatedSectionRegex,
                `\n## Related Notes\n${existingLinks}[[${relatedFile.basename}]]\n$2`
              );
            } else {
              // Link already exists, don't modify content
              Logger.info('Link already exists in Related Notes section');
              return;
            }
          } else {
            // Create new section at the bottom
            if (content.endsWith('\n')) {
              newContent = content + `\n## Related Notes\n[[${relatedFile.basename}]]\n`;
            } else {
              newContent = content + `\n\n## Related Notes\n[[${relatedFile.basename}]]\n`;
            }
          }

          editor.setValue(newContent);
          Logger.info('Link added successfully to Related Notes section');

          // Update button state
          addLinkButton.setText('Linked');
          addLinkButton.removeClass('related-note-add-link');
          addLinkButton.addClass('related-note-linked');
        });
      }
    }
  }
}

// Add styles to document
const style = document.createElement('style');
style.textContent = `
.related-notes-container {
  padding: 0 10px;
}

.related-notes-list {
  list-style: none;
  padding: 0;
}

.related-note-item {
  display: flex;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid var(--background-modifier-border);
}

.related-note-link {
  color: var(--text-accent);
  text-decoration: none;
  flex-grow: 1;
}

.related-note-add-link {
  font-size: 0.8em;
  padding: 4px 8px;
  background-color: var(--interactive-accent);
  color: var(--text-on-accent);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.related-note-add-link:hover {
  background-color: var(--interactive-accent-hover);
}

.related-note-linked {
  font-size: 0.8em;
  padding: 4px 8px;
  background-color: var(--background-modifier-success);
  color: var(--text-on-accent);
  border: none;
  border-radius: 4px;
  cursor: default;
}
`;

document.head.appendChild(style);
