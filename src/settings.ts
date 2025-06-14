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
  similarityProvider: 'auto' | 'bm25' | 'minhash' | 'bloom' | 'multi-bloom';
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
  // Multi-resolution bloom filter settings
  useMultiResolutionBloom: boolean;
  adaptiveParameters: boolean;
  multiResolutionNgramSizes: number[];
  multiResolutionBloomSizes: number[];
  multiResolutionHashFunctions: number[];
  commonWordsThreshold: number;
  maxStopwords: number;
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
  bloomFilterSize: 1024,
  bloomFilterHashFunctions: 3,
  ngramSize: 3,
  // Multi-resolution bloom filter settings
  useMultiResolutionBloom: false,
  adaptiveParameters: true,
  multiResolutionNgramSizes: [2, 3, 4],
  multiResolutionBloomSizes: [512, 1024, 512],
  multiResolutionHashFunctions: [2, 3, 2],
  commonWordsThreshold: 0.5,
  maxStopwords: 200
};

export class RelatedNotesSettingTab extends PluginSettingTab {
  plugin: RelatedNotesPlugin;
  reindexButton: HTMLButtonElement | null = null;

  constructor(app: App, plugin: RelatedNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  
  /**
   * Estimates the false positive rate of a bloom filter
   * @param m Size of the filter in bits
   * @param k Number of hash functions
   * @param n Number of elements in the filter
   * @returns Estimated false positive rate (0-1)
   */
  private estimateFalsePositiveRate(m: number, k: number, n: number): number {
    // False positive probability formula: (1 - e^(-k*n/m))^k
    const power = -k * n / m;
    const innerTerm = 1 - Math.exp(power);
    return Math.pow(innerTerm, k);
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
      .setName('Use Multi-Resolution Bloom Filter')
      .setDesc('Uses adaptive multi-resolution bloom filters for enhanced similarity. Works in any language and automatically adapts to your vault.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.useMultiResolutionBloom)
        .onChange(async (value) => {
          this.plugin.settings.useMultiResolutionBloom = value;
          if (value) {
            // If enabling multi-resolution, disable regular bloom filter
            this.plugin.settings.useBloomFilter = false;
          }
          await this.plugin.saveSettings();
          // Show/hide bloom filter settings based on toggle state
          this.display();
        }));

    // Only show multi-resolution bloom filter settings if enabled
    if (this.plugin.settings.useMultiResolutionBloom) {
      new Setting(containerEl)
        .setName('Use Adaptive Parameters')
        .setDesc('Automatically optimize parameters based on your vault characteristics.')
        .addToggle(toggle => toggle
          .setValue(this.plugin.settings.adaptiveParameters)
          .onChange(async (value) => {
            this.plugin.settings.adaptiveParameters = value;
            await this.plugin.saveSettings();
            this.display();
          }));

      // Only show manual parameter settings if adaptive parameters are disabled
      if (!this.plugin.settings.adaptiveParameters) {
        // N-gram sizes setting
        new Setting(containerEl)
          .setName('N-gram Sizes')
          .setDesc('Comma-separated list of n-gram sizes (2-5)')
          .addText(text => text
            .setValue(this.plugin.settings.multiResolutionNgramSizes.join(', '))
            .onChange(async (value) => {
              try {
                const sizes = value.split(',').map(s => parseInt(s.trim()));
                if (sizes.every(s => s >= 2 && s <= 5)) {
                  this.plugin.settings.multiResolutionNgramSizes = sizes;
                  await this.plugin.saveSettings();
                }
              } catch (e) {
                // Invalid input, don't update
              }
            }));

        // Bloom filter sizes setting
        new Setting(containerEl)
          .setName('Bloom Filter Sizes')
          .setDesc('Comma-separated list of bloom filter sizes (128-4096)')
          .addText(text => text
            .setValue(this.plugin.settings.multiResolutionBloomSizes.join(', '))
            .onChange(async (value) => {
              try {
                const sizes = value.split(',').map(s => parseInt(s.trim()));
                if (sizes.every(s => s >= 128 && s <= 4096)) {
                  this.plugin.settings.multiResolutionBloomSizes = sizes;
                  await this.plugin.saveSettings();
                }
              } catch (e) {
                // Invalid input, don't update
              }
            }));

        // Hash functions setting
        new Setting(containerEl)
          .setName('Hash Functions')
          .setDesc('Comma-separated list of hash function counts (1-5)')
          .addText(text => text
            .setValue(this.plugin.settings.multiResolutionHashFunctions.join(', '))
            .onChange(async (value) => {
              try {
                const counts = value.split(',').map(s => parseInt(s.trim()));
                if (counts.every(c => c >= 1 && c <= 5)) {
                  this.plugin.settings.multiResolutionHashFunctions = counts;
                  await this.plugin.saveSettings();
                }
              } catch (e) {
                // Invalid input, don't update
              }
            }));
      }

      // Common words settings
      new Setting(containerEl)
        .setName('Common Words Threshold')
        .setDesc('Words appearing in this percentage of documents are considered common (0.1-0.9)')
        .addSlider(slider => slider
          .setLimits(0.1, 0.9, 0.1)
          .setValue(this.plugin.settings.commonWordsThreshold)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.commonWordsThreshold = value;
            await this.plugin.saveSettings();
          }));

      new Setting(containerEl)
        .setName('Maximum Stopwords')
        .setDesc('Maximum number of common words to exclude (50-500)')
        .addSlider(slider => slider
          .setLimits(50, 500, 50)
          .setValue(this.plugin.settings.maxStopwords)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxStopwords = value;
            await this.plugin.saveSettings();
          }));

      // Add multi-resolution explanation
      const multiResExplanation = containerEl.createEl('div', { 
        cls: 'setting-item-description',
        text: 'Multi-resolution bloom filters combine multiple n-gram sizes for better accuracy. They automatically identify common words in your vault and work in any language.'
      });
    } else {
      // Show regular bloom filter toggle if multi-resolution is not enabled
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
          .setDesc('Size of the bloom filter in bits (128-4096). Larger filters use more memory but reduce false positives.')
          .addSlider(slider => slider
            .setLimits(128, 4096, 128)
            .setValue(this.plugin.settings.bloomFilterSize)
            .setDynamicTooltip()
            .onChange(async (value) => {
              this.plugin.settings.bloomFilterSize = value;
              await this.plugin.saveSettings();
            }));
          
        // Add memory usage information
        const memoryUsage = containerEl.createEl('div', { 
          cls: 'setting-item-description',
          text: `Memory usage: ${this.plugin.settings.bloomFilterSize / 8} bytes per document (${(this.plugin.settings.bloomFilterSize / 8 / 1024).toFixed(2)} KB)`
        });

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
        
        // Add hash function explanation
        const hashExplanation = containerEl.createEl('div', { 
          cls: 'setting-item-description',
          text: `With ${this.plugin.settings.bloomFilterHashFunctions} hash functions, false positive rate is approximately ${(this.estimateFalsePositiveRate(this.plugin.settings.bloomFilterSize, this.plugin.settings.bloomFilterHashFunctions, 100) * 100).toFixed(2)}% for 100 n-grams`
        });

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
            
        // Add n-gram explanation
        const ngramExplanation = containerEl.createEl('div', { 
          cls: 'setting-item-description' 
        });
        
        // Different explanations based on n-gram size
        switch (this.plugin.settings.ngramSize) {
          case 2:
            ngramExplanation.setText("2-grams (bigrams) are best for small documents or when speed is critical. Example: 'hello' → 'he', 'el', 'll', 'lo'");
            break;
          case 3:
            ngramExplanation.setText("3-grams (trigrams) offer a good balance between accuracy and performance. Example: 'hello' → 'hel', 'ell', 'llo'");
            break;
          case 4:
            ngramExplanation.setText("4-grams (quadgrams) provide better specificity but require more memory. Example: 'hello' → 'hell', 'ello'");
            break;
          case 5:
            ngramExplanation.setText("5-grams (pentagrams) capture more context but generate fewer matches. Example: 'hello' → 'hello'");
            break;
        }
      }
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