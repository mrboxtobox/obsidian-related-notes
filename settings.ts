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

    // Reindexing Section
    containerEl.createEl('h3', { text: 'Indexing' });

    const reindexSetting = new Setting(containerEl)
      .setName('Force Re-indexing')
      .setDesc('Force a complete re-indexing of all notes. This is useful when you want to ensure the most accurate related notes suggestions.');

    // Add the reindex button
    this.reindexButton = reindexSetting.controlEl.createEl('button', {
      text: 'Re-index All Notes',
      cls: 'mod-cta'
    });

    // Create container for progress indicator below the button
    const progressContainer = reindexSetting.controlEl.createDiv({ cls: 'related-notes-progress-container' });
    progressContainer.style.display = 'none';
    progressContainer.style.marginTop = '8px';
    progressContainer.style.width = '100%';
    progressContainer.style.height = '10px';
    progressContainer.style.backgroundColor = 'var(--background-modifier-border)';
    progressContainer.style.borderRadius = '5px';
    progressContainer.style.overflow = 'hidden';

    const progressIndicator = progressContainer.createDiv({ cls: 'related-notes-progress-indicator' });
    progressIndicator.style.width = '0%';
    progressIndicator.style.height = '100%';
    progressIndicator.style.backgroundColor = 'var(--interactive-accent)';
    progressIndicator.style.transition = 'width 0.5s ease';

    const progressText = reindexSetting.controlEl.createDiv({ cls: 'related-notes-progress-text' });
    progressText.style.display = 'none';
    progressText.style.fontSize = '12px';
    progressText.style.color = 'var(--text-muted)';
    progressText.style.marginTop = '4px';
    progressText.setText('0%');

    // Add click handler for reindex button
    this.reindexButton.addEventListener('click', async () => {
      // Disable button during re-indexing
      this.reindexButton!.disabled = true;
      this.reindexButton!.setText('Re-indexing...');

      // Show progress indicator
      progressContainer.style.display = 'block';
      progressText.style.display = 'inline';
      progressIndicator.style.width = '0%';
      progressText.setText('0%');

      // Simulate progress with a timer
      let progress = 0;
      const phases = ["Reading notes", "Analyzing patterns", "Finding connections", "Building relationships"];
      const interval = window.setInterval(() => {
        // Increment progress
        progress += 1;
        if (progress > 100) {
          clearInterval(interval);
          return;
        }

        // Update progress indicator
        progressIndicator.style.width = `${progress}%`;

        // Determine the current phase based on progress
        const phaseIndex = Math.floor(progress / 25);
        const phase = phases[Math.min(phaseIndex, phases.length - 1)];

        // Update progress text
        progressText.setText(`${phase}... ${progress}%`);
      }, 100); // Update every 100ms

      // Start actual re-indexing
      await this.plugin.forceReindex();

      // Clear the interval if it's still running
      clearInterval(interval);

      // Set progress to 100%
      progressIndicator.style.width = '100%';
      progressText.setText('Complete! 100%');

      // Hide progress indicator after a delay
      setTimeout(() => {
        progressContainer.style.display = 'none';
        progressText.style.display = 'none';

        // Re-enable button after re-indexing
        this.reindexButton!.disabled = false;
        this.reindexButton!.setText('Re-index All Notes');
      }, 1000);
    });

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
