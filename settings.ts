/**
 * @file Unified settings management for the Related Notes plugin.
 * Combines UI settings tab and core algorithm configuration.
 */

import { App, PluginSettingTab, Setting, ButtonComponent } from 'obsidian';
import RelatedNotesPlugin from './main';
import { Logger } from './utils';

/**
 * Plugin settings interface defining configuration options
 */
export interface RelatedNotesSettings {
  similarityThreshold: number;
  maxSuggestions: number;
  debugMode: boolean;
  showAdvanced: boolean;
  logLevel: 'error' | 'warn' | 'info' | 'debug';
}

/**
 * Core algorithm configuration interface
 */
export interface AlgorithmConfig {
  // MinHash LSH Configuration
  minHash: {
    numHashes: number;      // Number of hash functions to use
    numBands: number;       // Number of bands for LSH
    bandSize: number;       // Size of each band (derived from numHashes/numBands)
    fuzzyDistance: number;  // Maximum edit distance for fuzzy matching
  };

  // BM25 Configuration
  bm25: {
    k1: number;  // Term frequency saturation parameter
    b: number;   // Length normalization parameter
  };

  // MinHash LSH + BM25 Scoring
  minhashLsh: {
    titleWeight: number;    // Weight multiplier for title matches
  };

  // Processing Configuration
  processing: {
    batchSize: {
      indexing: number;     // Batch size for initial indexing
      search: number;       // Batch size for similarity search
      lsh: number;         // Batch size for LSH operations
    };
    delayBetweenBatches: number;  // Milliseconds to wait between batches
  };
}

/**
 * Default algorithm configuration
 */
export const DEFAULT_CONFIG: AlgorithmConfig = {
  minHash: {
    numHashes: 10,
    numBands: 2,
    bandSize: 5,  // Derived from numHashes/numBands
    fuzzyDistance: 1
  },

  bm25: {
    k1: 1.5,  // Increased to give more weight to term frequency
    b: 0.85   // Increased to give more weight to document length normalization
  },

  minhashLsh: {
    titleWeight: 1.0 // Increase to give titles more weight.
  },

  processing: {
    batchSize: {
      indexing: 1,  // Process 3 files at a time during initial indexing
      search: 1,    // Process 2 files at a time during similarity search
      lsh: 1        // Process 3 documents at a time for LSH operations
    },
    delayBetweenBatches: 50  // 50ms delay between batches for mobile performance
  }
};

/**
 * Settings tab implementation that provides UI controls for configuring the plugin.
 * Allows users to customize similarity provider, debug mode, similarity threshold,
 * and maximum number of suggestions.
 */
export class RelatedNotesSettingTab extends PluginSettingTab {
  plugin: RelatedNotesPlugin;

  constructor(app: App, plugin: RelatedNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Related Notes Settings' });

    // Basic Settings
    new Setting(containerEl)
      .setName('Show Advanced Settings')
      .setDesc('Toggle to show or hide advanced configuration options.')
      .addToggle(toggle => {
        toggle
          .setValue(this.plugin.settings.showAdvanced || false)
          .onChange(async (value) => {
            this.plugin.settings.showAdvanced = value;
            await this.plugin.saveSettings();
            this.display(); // Refresh to show/hide advanced settings
          });
      });

    containerEl.createEl('h3', { text: 'Basic Settings' });

    new Setting(containerEl)
      .setName('Log Level')
      .setDesc('Control the verbosity of logging. Error shows only errors, Warn adds warnings, Info adds general information, Debug shows all details.')
      .addDropdown(dropdown => dropdown
        .addOption('error', 'Error')
        .addOption('warn', 'Warning')
        .addOption('info', 'Info')
        .addOption('debug', 'Debug')
        .setValue(this.plugin.settings.logLevel)
        .onChange(async (value) => {
          this.plugin.settings.logLevel = value as 'error' | 'warn' | 'info' | 'debug';
          await this.plugin.saveSettings();
        }));

    if (!this.plugin.settings.showAdvanced) {
      return;
    }

    // Advanced Settings
    containerEl.createEl('h3', { text: 'Advanced Settings' });

    new Setting(containerEl)
      .setName('Debug Mode')
      .setDesc('Enable detailed logging and show similarity scores.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Similarity Threshold')
      .setDesc('Minimum similarity score (0-1) required to consider notes as related.')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.similarityThreshold)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.similarityThreshold = value;
          await this.plugin.saveSettings();
        }));

    // Processing Settings
    containerEl.createEl('h3', { text: 'Processing Settings' });
    containerEl.createEl('p', {
      text: 'Configure batch processing settings. Lower values are better for mobile devices but may increase processing time.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('Initial Indexing Batch Size')
      .setDesc('Number of files to process simultaneously during initial vault indexing.')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(DEFAULT_CONFIG.processing.batchSize.indexing)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.processing.batchSize.indexing = value;
        }));

    new Setting(containerEl)
      .setName('Search Batch Size')
      .setDesc('Number of files to process simultaneously when searching for related notes.')
      .addSlider(slider => slider
        .setLimits(1, 5, 1)
        .setValue(DEFAULT_CONFIG.processing.batchSize.search)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.processing.batchSize.search = value;
        }));

    new Setting(containerEl)
      .setName('LSH Batch Size')
      .setDesc('Number of documents to process simultaneously for LSH operations.')
      .addSlider(slider => slider
        .setLimits(1, 5, 1)
        .setValue(DEFAULT_CONFIG.processing.batchSize.lsh)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.processing.batchSize.lsh = value;
        }));

    new Setting(containerEl)
      .setName('Batch Processing Delay')
      .setDesc('Milliseconds to wait between processing batches (higher values reduce device load).')
      .addSlider(slider => slider
        .setLimits(0, 200, 10)
        .setValue(DEFAULT_CONFIG.processing.delayBetweenBatches)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.processing.delayBetweenBatches = value;
        }));

    // BM25 Settings
    containerEl.createEl('h3', { text: 'BM25 Algorithm Settings' });
    containerEl.createEl('p', {
      text: 'Fine-tune the BM25 ranking algorithm parameters. These affect how term frequency and document length influence similarity scores.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('k1 Parameter')
      .setDesc('Controls term frequency saturation. Higher values give more weight to term frequency.')
      .addSlider(slider => slider
        .setLimits(0.5, 2.0, 0.1)
        .setValue(DEFAULT_CONFIG.bm25.k1)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.bm25.k1 = value;
        }));

    new Setting(containerEl)
      .setName('b Parameter')
      .setDesc('Controls document length normalization. Higher values give more penalty to longer documents.')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(DEFAULT_CONFIG.bm25.b)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.bm25.b = value;
        }));

    // MinHash LSH Settings
    containerEl.createEl('h3', { text: 'MinHash LSH Settings' });
    containerEl.createEl('p', {
      text: 'Configure MinHash Locality-Sensitive Hashing parameters. These affect the trade-off between accuracy and performance.',
      cls: 'setting-item-description'
    });

    new Setting(containerEl)
      .setName('Number of Hash Functions')
      .setDesc('Number of hash functions to use for MinHash. Higher values increase accuracy but use more memory.')
      .addSlider(slider => slider
        .setLimits(50, 200, 10)
        .setValue(DEFAULT_CONFIG.minHash.numHashes)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.minHash.numHashes = value;
        }));

    new Setting(containerEl)
      .setName('Number of Bands')
      .setDesc('Number of bands for LSH. Higher values increase recall but may reduce precision.')
      .addSlider(slider => slider
        .setLimits(10, 50, 5)
        .setValue(DEFAULT_CONFIG.minHash.numBands)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.minHash.numBands = value;
          DEFAULT_CONFIG.minHash.bandSize = Math.floor(DEFAULT_CONFIG.minHash.numHashes / value);
        }));

    new Setting(containerEl)
      .setName('Fuzzy Match Distance')
      .setDesc('Maximum edit distance for fuzzy matching. Higher values match more similar terms.')
      .addSlider(slider => slider
        .setLimits(0, 3, 1)
        .setValue(DEFAULT_CONFIG.minHash.fuzzyDistance)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.minHash.fuzzyDistance = value;
        }));

    // MinHash LSH + BM25 Settings
    containerEl.createEl('h3', { text: 'MinHash LSH + BM25 Settings' });

    new Setting(containerEl)
      .setName('Title Weight')
      .setDesc('Weight multiplier for matches in note titles. Higher values give more importance to title matches.')
      .addSlider(slider => slider
        .setLimits(1, 5, 0.5)
        .setValue(DEFAULT_CONFIG.minhashLsh.titleWeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          DEFAULT_CONFIG.minhashLsh.titleWeight = value;
        }));

    // Reset Button
    new Setting(containerEl)
      .setName('Reset to Defaults')
      .setDesc('Reset all algorithm settings to their default values.')
      .addButton((button: ButtonComponent) => {
        button
          .setButtonText('Reset')
          .onClick(async () => {
            Object.assign(DEFAULT_CONFIG, {
              minHash: {
                numHashes: 100,
                numBands: 20,
                bandSize: 5,
                fuzzyDistance: 1
              },
              bm25: {
                k1: 1.2,
                b: 0.75
              },
              minhashLsh: {
                titleWeight: 2.0
              },
              processing: {
                batchSize: {
                  indexing: 3,
                  search: 2,
                  lsh: 3
                },
                delayBetweenBatches: 50
              }
            });
            this.display(); // Refresh the settings tab
          });
      });
  }
}
