import { App, PluginSettingTab, Setting } from 'obsidian';
import RelatedNotesPlugin from './main';
import { Logger } from './logger';

export class RelatedNotesSettingTab extends PluginSettingTab {
  plugin: RelatedNotesPlugin;

  constructor(app: App, plugin: RelatedNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    Logger.info('Displaying settings tab');
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl('h2', { text: 'Related Notes Settings' });

    new Setting(containerEl)
      .setName('Embedding Provider')
      .setDesc('Choose which embedding provider to use for calculating note similarity.')
      .addDropdown(dropdown => dropdown
        .addOption('bm25', 'BM25 (Local)')
        .addOption('hybrid', 'Hybrid BM25 + MinHash LSH (Local)')
        .setValue(this.plugin.settings.embeddingProvider)
        .onChange(async (value) => {
          this.plugin.settings.embeddingProvider = value as 'bm25' | 'hybrid';
          await this.plugin.saveSettings();
          Logger.info('Embedding provider changed:', value);
        }));

    new Setting(containerEl)
      .setName('Debug Mode')
      .setDesc('Enable detailed logging for troubleshooting.')
      .addToggle(toggle => toggle
        .setValue(false) // Default to false
        .onChange(async (value) => {
          Logger.setDebugMode(value);
          Logger.info('Debug mode setting changed:', value);
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
          Logger.info('Similarity threshold changed:', value);
        }));

    new Setting(containerEl)
      .setName('Maximum Suggestions')
      .setDesc('Maximum number of related notes to display.')
      .addSlider(slider => slider
        .setLimits(1, 10, 1)
        .setValue(this.plugin.settings.maxSuggestions)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.maxSuggestions = value;
          await this.plugin.saveSettings();
          Logger.info('Maximum suggestions changed:', value);
        }));

    Logger.info('Settings tab display complete');
  }
}
