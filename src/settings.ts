/**
 * @file Settings tab for the Related Notes plugin.
 * Implements the settings interface and tab for configuring the plugin.
 */

import { App, PluginSettingTab, Setting } from 'obsidian';
import RelatedNotesPlugin from './main';

'use strict';

export interface RelatedNotesSettings {
  maxSuggestions: number;
  advancedSettingsEnabled: boolean;
  similarityProvider: 'auto' | 'bm25' | 'minhash';
  debugMode: boolean;
  similarityThreshold: number;
  batchSize: number;
  priorityIndexSize: number;
  disableIncrementalUpdates: boolean;
  showStats: boolean;
}

export const DEFAULT_SETTINGS: RelatedNotesSettings = {
  maxSuggestions: 5,
  advancedSettingsEnabled: false,
  similarityProvider: 'auto',
  debugMode: false,
  similarityThreshold: 0.3,
  batchSize: 1,
  priorityIndexSize: 10000,
  disableIncrementalUpdates: false,
  showStats: false
};

export class RelatedNotesSettingTab extends PluginSettingTab {
  plugin: RelatedNotesPlugin;
  reindexButton: HTMLButtonElement | null = null;

  constructor(app: App, plugin: RelatedNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Maximum Suggestions')
      .setDesc('Maximum number of related notes to display (1-20)')
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.maxSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSuggestions = value;
          await this.plugin.saveSettings();
        }));

    const reindexSetting = new Setting(containerEl)
      .setName('Rebuild index')
      .setDesc('Force a complete re-indexing of all notes. Indexing may several minutes depending on the size of your vault.');

    // Create button container for reindex and cancel buttons
    const buttonContainer = reindexSetting.controlEl.createDiv({ cls: 'related-notes-button-container' });

    // Add the reindex button
    this.reindexButton = buttonContainer.createEl('button', {
      text: 'Re-index all notes',
      cls: 'mod-cta'
    });

    // Disable the button if indexing is already in progress or initialization is not complete
    if (this.plugin.isReindexingInProgress() || !this.plugin.isInitializationComplete()) {
      this.reindexButton.disabled = true;

      // Set appropriate tooltip based on the reason for disabling
      if (this.plugin.isReindexingInProgress()) {
        this.reindexButton.title = "Re-indexing is already in progress";
      } else if (!this.plugin.isInitializationComplete()) {
        this.reindexButton.title = "Initial indexing is still in progress";
      }
    }

    // Add cancel button (initially hidden unless re-indexing is in progress)
    const cancelButton = buttonContainer.createEl('button', {
      text: 'Cancel',
      cls: 'mod-warning'
    });

    // Show cancel button if re-indexing is in progress
    if (this.plugin.isReindexingInProgress()) {
      cancelButton.addClass('related-notes-cancel-button-visible');
      cancelButton.removeClass('related-notes-cancel-button-hidden');
      this.reindexButton!.disabled = true;
      this.reindexButton!.setText('Re-indexing...');

      // Add click handler for cancel button when display is refreshed during re-indexing
      cancelButton.addEventListener('click', () => {
        // Handle the actual cancellation in the main plugin
        this.plugin.cancelReindex();

        // Reset UI
        this.reindexButton!.disabled = false;
        this.reindexButton!.setText('Re-index all notes');
        cancelButton.removeClass('related-notes-cancel-button-visible');
        cancelButton.addClass('related-notes-cancel-button-hidden');
      });
    } else {
      cancelButton.addClass('related-notes-cancel-button-hidden');
      cancelButton.removeClass('related-notes-cancel-button-visible');
    }

    // Add click handler for reindex button
    this.reindexButton.addEventListener('click', async () => {
      // Disable reindex button and show cancel button
      this.reindexButton!.disabled = true;
      this.reindexButton!.setText('Re-indexing...');
      cancelButton.removeClass('related-notes-cancel-button-hidden');
      cancelButton.addClass('related-notes-cancel-button-visible');

      // Variable to track if indexing was cancelled
      let cancelled = false;

      // Add click handler for cancel button
      const cancelHandler = () => {
        cancelled = true;
        // We'll handle the actual cancellation in the main plugin
        this.plugin.cancelReindex();

        // Reset UI
        this.reindexButton!.disabled = false;
        this.reindexButton!.setText('Re-index all notes');
        cancelButton.removeClass('related-notes-cancel-button-visible');
        cancelButton.addClass('related-notes-cancel-button-hidden');
      };

      // Add the cancel handler
      cancelButton.addEventListener('click', cancelHandler);

      try {
        // Start actual re-indexing
        await this.plugin.forceReindex();
      } catch (error: unknown) {
        // Only log errors that aren't cancellation
        if (!(error instanceof Error && error.message === 'Indexing cancelled')) {
          console.error('Error during re-indexing:', error);
        }
      } finally {
        // Clean up
        cancelButton.removeEventListener('click', cancelHandler);
        cancelButton.removeClass('related-notes-cancel-button-visible');
        cancelButton.addClass('related-notes-cancel-button-hidden');

        // Only reset the button if indexing wasn't cancelled (it's already reset in the cancel handler)
        if (!cancelled) {
          this.reindexButton!.disabled = false;
          this.reindexButton!.setText('Re-index all notes');
        }
      }
    });
  }
}
