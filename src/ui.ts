import { ItemView, WorkspaceLeaf, TFile, MarkdownView } from 'obsidian';
import RelatedNotesPlugin from './main';

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

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl('h4', { text: 'Related Notes' });

    // Create content container
    const contentEl = container.createDiv('related-notes-content');

    // Add CSS classes
    this.containerEl.addClass('related-notes-container');
  }

  async updateForFile(file: TFile | null, relatedNotes: Array<{ file: TFile; similarity: number }>) {
    const container = this.containerEl.children[1];
    const contentEl = container.querySelector('.related-notes-content');
    if (!contentEl) return;

    contentEl.empty();
    this.currentFile = file;

    if (!file || !relatedNotes.length) {
      contentEl.createEl('p', { text: 'No related notes found.' });
      return;
    }

    // Create list of related notes
    const listEl = contentEl.createEl('ul');
    listEl.addClass('related-notes-list');

    for (const { file: relatedFile, similarity } of relatedNotes) {
      const listItemEl = listEl.createEl('li');
      listItemEl.addClass('related-note-item');

      // Create link to the related note
      const linkEl = listItemEl.createEl('a', {
        text: relatedFile.basename,
        cls: 'related-note-link'
      });

      // Add similarity score
      const scoreEl = listItemEl.createEl('span', {
        text: ` (${(similarity * 100).toFixed(1)}% similar)`,
        cls: 'related-note-score'
      });

      // Add click handler
      linkEl.addEventListener('click', async (e) => {
        e.preventDefault();
        await this.app.workspace.getLeaf().openFile(relatedFile);
      });

      // Add "Add Link" button
      const addLinkButton = listItemEl.createEl('button', {
        text: 'Add Link',
        cls: 'related-note-add-link'
      });

      addLinkButton.addEventListener('click', async () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;

        const editor = activeView.editor;
        const cursor = editor.getCursor();
        const linkText = `[[${relatedFile.basename}]]`;
        editor.replaceRange(linkText, cursor);
      });
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

.related-note-score {
  color: var(--text-muted);
  font-size: 0.9em;
  margin-right: 10px;
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
`;

document.head.appendChild(style);
