/**
 * @file Settings tab for the Related Notes plugin.
 * Implements the settings interface and tab for configuring the plugin.
 */

import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import RelatedNotesPlugin from './main';

'use strict';

export interface RelatedNotesSettings {
  maxSuggestions: number;
  debugMode: boolean;          // Enable debug logging
  customTitle: string;         // Custom text for "Related Notes"
  // Internal settings - not exposed to users
  similarityThreshold: number;
  batchSize: number;
  priorityIndexSize: number;
  ngramSizes: number[];
  hashFunctions: number[];
  commonWordsThreshold: number;
  maxStopwords: number;
  enableSampling: boolean;     // Whether to use sampling for large vaults
  sampleSizeThreshold: number; // Minimum corpus size to trigger sampling
  maxSampleSize: number;       // Maximum documents to sample
  lastKnownVersion?: string;   // Track the last known version for cache invalidation
}

export const DEFAULT_SETTINGS: RelatedNotesSettings = {
  maxSuggestions: 5,
  debugMode: false,           // Debug mode disabled by default
  customTitle: 'Related Notes',
  enableSampling: true,
  // Internal settings with good defaults
  similarityThreshold: 0.15, // Lowered from 0.3 to find more matches
  batchSize: 5, // Smaller batch size for more responsive processing
  priorityIndexSize: 10000,
  ngramSizes: [3],
  hashFunctions: [3],
  commonWordsThreshold: 0.5,
  maxStopwords: 200,
  sampleSizeThreshold: 5000,  // Only sample when more than 5000 files
  maxSampleSize: 1000         // Maximum number of documents to sample
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

  /**
   * Generate debug information without PII
   * @returns String containing debug information
   */
  private generateDebugInfo(): string {
    const vault = this.app.vault;
    const files = vault.getMarkdownFiles();
    const stats = this.plugin.similarityProvider?.getStats?.();

    const debugInfo = {
      timestamp: new Date().toISOString(),
      plugin: {
        version: this.plugin.manifest.version,
        initialized: this.plugin.isInitializationComplete(),
        reindexing: this.plugin.isReindexingInProgress()
      },
      vault: {
        totalMarkdownFiles: files.length,
        configDirExists: !!vault.configDir
      },
      settings: {
        maxSuggestions: this.plugin.settings.maxSuggestions,
        debugMode: this.plugin.settings.debugMode,
        similarityThreshold: this.plugin.settings.similarityThreshold,
        enableSampling: this.plugin.settings.enableSampling,
        sampleSizeThreshold: this.plugin.settings.sampleSizeThreshold,
        maxSampleSize: this.plugin.settings.maxSampleSize,
        ngramSizes: this.plugin.settings.ngramSizes,
        hashFunctions: this.plugin.settings.hashFunctions
      },
      system: {
        platform: navigator.platform,
        userAgent: navigator.userAgent,
        memoryAvailable: (navigator as any).deviceMemory || 'unknown',
        hardwareConcurrency: navigator.hardwareConcurrency || 'unknown'
      },
      index: stats ? {
        documentsIndexed: stats.documentsProcessed || 0,
        progressiveIndexing: stats.progressiveIndexing,
        memoryUsage: stats.memoryUsage,
        avgProcessingTime: stats.averageProcessingTime
      } : null
    };

    return JSON.stringify(debugInfo, null, 2);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Related Notes Settings' });

    // === BASIC SETTINGS ===
    new Setting(containerEl)
      .setName('Maximum suggestions')
      .setDesc('Maximum number of related notes to display (1–20).')
      .addSlider(slider => slider
        .setLimits(1, 20, 1)
        .setValue(this.plugin.settings.maxSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSuggestions = value;
          await this.plugin.saveSettings();
        }));

    new Setting(containerEl)
      .setName('Custom title')
      .setDesc('Customize the text displayed in place of "Related Notes".')
      .addText(text => text
        .setPlaceholder('Related Notes')
        .setValue(this.plugin.settings.customTitle)
        .onChange(async (value) => {
          this.plugin.settings.customTitle = value || 'Related Notes';
          await this.plugin.saveSettings();
        }));

    // === INDEX MANAGEMENT ===
    const reindexSetting = new Setting(containerEl)
      .setName('Rebuild index')
      .setDesc('Update the index if related notes suggestions seem out of date.');

    const clearCacheSetting = new Setting(containerEl)
      .setName('Clear cache')
      .setDesc('Remove all cached data and start fresh. Use this if you encounter issues.');

    // Add the clear cache button
    clearCacheSetting.addButton(button =>
      button
        .setButtonText('Clear cache')
        .setCta()
        .onClick(async () => {
          // Disable the button during operation
          button.setDisabled(true);
          button.setButtonText('Clearing...');

          try {
            // Call the plugin method to clear cache
            await this.plugin.clearCache();

            // Show success message
            new Notice('Cache cleared successfully');
          } catch (error) {
            console.error('Error clearing cache:', error);
            new Notice('Error clearing cache');
          } finally {
            // Re-enable the button
            button.setDisabled(false);
            button.setButtonText('Clear cache');
          }
        })
    );

    // Create button container for reindex and cancel buttons
    const buttonContainer = reindexSetting.controlEl.createDiv({ cls: 'related-notes-button-container' });

    // Add the reindex button
    this.reindexButton = buttonContainer.createEl('button', {
      text: 'Rebuild index',
      cls: 'mod-cta'
    });

    // Disable the button if indexing is already in progress, initialization is not complete,
    // or on-demand computation is disabled
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
        this.reindexButton!.setText('Rebuild index');
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
        this.reindexButton!.setText('Rebuild index');
        cancelButton.removeClass('related-notes-cancel-button-visible');
        cancelButton.addClass('related-notes-cancel-button-hidden');
      };

      // Add the cancel handler
      cancelButton.addEventListener('click', cancelHandler);

      try {
        // Start actual re-indexing
        await this.plugin.forceReindex();
      } catch (error: unknown) {
        // Log non-cancellation errors
        if (!(error instanceof Error && error.message === 'Indexing cancelled')) {
          console.error('Error during re-indexing:', error);
        }
      } finally {
        // Clean up
        cancelButton.removeEventListener('click', cancelHandler);
        cancelButton.removeClass('related-notes-cancel-button-visible');
        cancelButton.addClass('related-notes-cancel-button-hidden');

        // Reset the button state (always safe to do this in finally)
        this.reindexButton!.disabled = false;
        this.reindexButton!.setText('Rebuild index');
      }
    });

    // === DEBUG & TROUBLESHOOTING ===
    new Setting(containerEl)
      .setName('Debug mode')
      .setDesc('Enable debug logging to the console. Useful for troubleshooting but may impact performance.')
      .addToggle(toggle => toggle
        .setValue(this.plugin.settings.debugMode)
        .onChange(async (value) => {
          this.plugin.settings.debugMode = value;
          await this.plugin.saveSettings();
          // Show notice about needing to restart for changes to take full effect
          if (value) {
            new Notice('Debug mode enabled. Some debug messages will appear in the developer console.');
          } else {
            new Notice('Debug mode disabled.');
          }
        }));

    // Report a bug button
    new Setting(containerEl)
      .setName('Report a bug')
      .setDesc('Open GitHub issues page to report bugs or request features')
      .addButton(button => button
        .setButtonText('Report a bug ↗')
        .setCta()
        .onClick(() => {
          window.open('https://github.com/mrboxtobox/obsidian-related-notes/issues', '_blank');
        }));

    new Setting(containerEl)
      .setName('Copy debug info')
      .setDesc('Copy debug information to clipboard for bug reports.')
      .addButton(button => button
        .setButtonText('Copy debug info')
        .setCta()
        .onClick(async () => {
          try {
            const debugInfo = this.generateDebugInfo();
            await navigator.clipboard.writeText(debugInfo);
            new Notice('Debug info copied to clipboard! Please include this when reporting bugs.');
          } catch (error) {
            console.error('Failed to copy debug info:', error);
            new Notice('Failed to copy debug info. Please try again or check console for details.');
          }
        }));

    // === SUPPORT THE PROJECT ===
    const supportEl = containerEl.createEl('div', { cls: 'related-notes-support-section' });
    supportEl.createEl('p', {
      text: 'If this plugin helps you discover meaningful connections in your notes, consider supporting its development:'
    });

    supportEl.innerHTML = '<div style="text-align: left;"><a href="https://www.buymeacoffee.com/mrboxtobox" target="_blank" rel="noopener noreferrer"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me a coffee&emoji=&slug=mrboxtobox&button_colour=5F7FFF&font_colour=ffffff&font_family=Cookie&outline_colour=000000&coffee_colour=FFDD00" /></a></div>';
  }
}