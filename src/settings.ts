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
  onDemandComputationEnabled: boolean;
  disableIncrementalUpdates: boolean;
  showStats: boolean;
  // Bloom filter settings
  useBloomFilter: boolean;
  bloomFilterSize: number;
  bloomFilterHashFunctions: number;
  ngramSize: number;
}

export const DEFAULT_SETTINGS: RelatedNotesSettings = {
  maxSuggestions: 5,
  advancedSettingsEnabled: false,
  similarityProvider: 'auto',
  debugMode: false,
  similarityThreshold: 0.3,
  batchSize: 1,
  priorityIndexSize: 10000,
  onDemandComputationEnabled: true,
  disableIncrementalUpdates: false,
  showStats: false,
  // Bloom filter settings (defaults)
  useBloomFilter: false,
  bloomFilterSize: 256,
  bloomFilterHashFunctions: 3,
  ngramSize: 3
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

    containerEl.createEl('h2', { text: 'Related Notes Settings' });

    // Basic Settings Section
    containerEl.createEl('h3', { text: 'Basic Settings' });

    new Setting(containerEl)
      .setName('Maximum suggestions')
      .setDesc('Maximum number of related notes to display (1-20)')
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.maxSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSuggestions = value;
          await this.plugin.saveSettings();
        }));

    // Similarity Provider Section
    containerEl.createEl('h3', { text: 'Similarity Algorithm' });

    new Setting(containerEl)
      .setName('Use Bloom Filter Similarity')
      .setDesc('Uses a lightweight bloom filter algorithm for similarity calculation. Better for large vaults and mobile devices.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useBloomFilter)
        .onChange(async (value) => {
          this.plugin.settings.useBloomFilter = value;
          await this.plugin.saveSettings();
          // Show/hide bloom filter settings based on toggle state
          this.display();
        }));

    // Only show bloom filter settings if enabled
    if (this.plugin.settings.useBloomFilter) {
      new Setting(containerEl)
        .setName('Bloom Filter Size')
        .setDesc('Size of the bloom filter in bits (128-1024). Larger filters use more memory but reduce false positives.')
        .addSlider(slider => slider
          .setLimits(128, 1024, 128)
          .setValue(this.plugin.settings.bloomFilterSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.bloomFilterSize = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Hash Functions')
        .setDesc('Number of hash functions (1-5). More functions improve accuracy but increase computation time.')
        .addSlider(slider => slider
          .setLimits(1, 5, 1)
          .setValue(this.plugin.settings.bloomFilterHashFunctions)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.bloomFilterHashFunctions = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('N-gram Size')
        .setDesc('Size of character n-grams (2-5). Larger n-grams capture more context but increase memory usage.')
        .addSlider(slider => slider
          .setLimits(2, 5, 1)
          .setValue(this.plugin.settings.ngramSize)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.ngramSize = value;
            await this.plugin.saveSettings();
          }));
    }

    // Reindexing Section
    containerEl.createEl('h3', { text: 'Indexing' });
    containerEl.createEl('h4', { text: 'This process may take a long time for large vaults' });

    const reindexSetting = new Setting(containerEl)
      .setName('Force Re-indexing')
      .setDesc('Force a complete re-indexing of all notes. Re-indexing may take a while depending on the size of your vault.');

    // Create button container for reindex and cancel buttons
    const buttonContainer = reindexSetting.controlEl.createDiv({ cls: 'related-notes-button-container' });

    // Add the reindex button
    this.reindexButton = buttonContainer.createEl('button', {
      text: 'Re-index All Notes',
      cls: 'mod-cta'
    });

    // Disable the button if indexing is already in progress, initialization is not complete,
    // or on-demand computation is disabled
    if (this.plugin.isReindexingInProgress() || !this.plugin.isInitializationComplete() || !this.plugin.settings.onDemandComputationEnabled) {
      this.reindexButton.disabled = true;

      // Set appropriate tooltip based on the reason for disabling
      if (this.plugin.isReindexingInProgress()) {
        this.reindexButton.title = "Re-indexing is already in progress";
      } else if (!this.plugin.isInitializationComplete()) {
        this.reindexButton.title = "Initial indexing is still in progress";
      } else if (!this.plugin.settings.onDemandComputationEnabled) {
        this.reindexButton.title = "Re-indexing is disabled when on-demand computation is turned off";
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
        this.reindexButton!.setText('Re-index All Notes');
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
        this.reindexButton!.setText('Re-index All Notes');
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
          this.reindexButton!.setText('Re-index All Notes');
        }
      }
    });

    // Advanced Settings Section
    containerEl.createEl('h3', { text: 'Advanced Settings' });

    new Setting(containerEl)
      .setName('Enable On-Demand Computation')
      .setDesc('Enables on-the-fly similarity computation for files that are not in the priority index.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.onDemandComputationEnabled)
        .onChange(async (value) => {
          this.plugin.settings.onDemandComputationEnabled = value;
          await this.plugin.saveSettings();
          // Refresh the display to update the reindex button state
          this.display();
        }));

    new Setting(containerEl)
      .setName('Priority Index Size')
      .setDesc('Number of files to pre-index based on access frequency (1000-20000).')
      .addSlider(slider => slider
        .setLimits(1000, 20000, 1000)
        .setValue(this.plugin.settings.priorityIndexSize)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.priorityIndexSize = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Disable Incremental Updates')
      .setDesc('Only re-index on application restart (reduces background CPU usage).')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.disableIncrementalUpdates)
        .onChange(async (value) => {
          this.plugin.settings.disableIncrementalUpdates = value;
          await this.plugin.saveSettings();
        }));

    // Show Stats Toggle
    new Setting(containerEl)
      .setName('Show Stats')
      .setDesc('Show memory usage and NLP-related metrics in the Related Notes view')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.showStats)
        .onChange(async (value) => {
          this.plugin.settings.showStats = value;
          await this.plugin.saveSettings();
          // Refresh the display to show/hide stats
          this.display();
        }));

    // If stats are enabled, show the current stats
    if (this.plugin.settings.showStats) {
      const statsContainer = containerEl.createEl('div', { cls: 'related-notes-stats-container' });

      // Memory usage stats
      const memoryStatsEl = statsContainer.createEl('div', { cls: 'related-notes-stats-section' });
      memoryStatsEl.createEl('h4', { text: 'Memory Usage' });

      const memoryList = memoryStatsEl.createEl('ul', { cls: 'related-notes-stats-list' });

      // Get memory stats from the similarity provider
      if (this.plugin.similarityProvider && this.plugin.isInitializationComplete()) {
        const memoryStats = this.plugin.getMemoryStats();

        memoryList.createEl('li', {
          text: `Vocabulary Size: ${memoryStats.vocabularySize.toLocaleString()} terms`
        });
        memoryList.createEl('li', {
          text: `File Vectors: ${memoryStats.fileVectorsCount.toLocaleString()} files`
        });
        memoryList.createEl('li', {
          text: `Signatures: ${memoryStats.signaturesCount.toLocaleString()} signatures`
        });
        memoryList.createEl('li', {
          text: `Related Notes Cache: ${memoryStats.relatedNotesCount.toLocaleString()} entries`
        });
        memoryList.createEl('li', {
          text: `On-Demand Cache: ${memoryStats.onDemandCacheCount.toLocaleString()} entries`
        });
        memoryList.createEl('li', {
          text: `Estimated Memory Usage: ${memoryStats.estimatedMemoryUsage.toLocaleString()} KB`
        });
      } else {
        memoryList.createEl('li', {
          text: 'Stats will be available after initialization is complete'
        });
      }

      // NLP stats
      const nlpStatsEl = statsContainer.createEl('div', { cls: 'related-notes-stats-section' });
      nlpStatsEl.createEl('h4', { text: 'NLP Metrics' });

      const nlpList = nlpStatsEl.createEl('ul', { cls: 'related-notes-stats-list' });

      // Get NLP stats from the similarity provider
      if (this.plugin.similarityProvider && this.plugin.isInitializationComplete()) {
        const nlpStats = this.plugin.getNLPStats();

        nlpList.createEl('li', {
          text: `Average Shingle Size: ${nlpStats.averageShingleSize.toFixed(2)} terms`
        });
        nlpList.createEl('li', {
          text: `Average Document Length: ${nlpStats.averageDocLength.toFixed(2)} terms`
        });
        nlpList.createEl('li', {
          text: `Similarity Provider: ${nlpStats.similarityProvider}`
        });
        nlpList.createEl('li', {
          text: `LSH Bands: ${nlpStats.lshBands}`
        });
        nlpList.createEl('li', {
          text: `LSH Rows Per Band: ${nlpStats.lshRowsPerBand}`
        });
        nlpList.createEl('li', {
          text: `Average Similarity Score: ${nlpStats.averageSimilarityScore.toFixed(4)}`
        });
        nlpList.createEl('li', {
          text: `Corpus Sampled: ${nlpStats.isCorpusSampled ? 'Yes' : 'No'}`
        });
        nlpList.createEl('li', {
          text: `Total Files: ${nlpStats.totalFiles.toLocaleString()}`
        });
        nlpList.createEl('li', {
          text: `Indexed Files: ${nlpStats.indexedFiles.toLocaleString()}`
        });
        nlpList.createEl('li', {
          text: `On-Demand Computations: ${nlpStats.onDemandComputations.toLocaleString()}`
        });
      } else {
        nlpList.createEl('li', {
          text: 'Stats will be available after initialization is complete'
        });
      }
    }
  }
}