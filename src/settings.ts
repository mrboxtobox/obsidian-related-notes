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
      .setName('Existing Link Weight')
      .setDesc('Weight given to existing links when calculating relationships (0-1).')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.existingLinkWeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.existingLinkWeight = value;
          await this.plugin.saveSettings();
          Logger.info('Existing link weight changed:', value);
        }));

    new Setting(containerEl)
      .setName('Content Similarity Weight')
      .setDesc('Weight given to content similarity when calculating relationships (0-1).')
      .addSlider(slider => slider
        .setLimits(0, 1, 0.05)
        .setValue(this.plugin.settings.contentSimilarityWeight)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.contentSimilarityWeight = value;
          await this.plugin.saveSettings();
          Logger.info('Content similarity weight changed:', value);
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

    new Setting(containerEl)
      .setName('Cache Timeout')
      .setDesc('How long to cache similarity calculations (in minutes).')
      .addSlider(slider => slider
        .setLimits(1, 30, 1)
        .setValue(this.plugin.settings.cacheTimeout / 60000)
        .setDynamicTooltip()
        .onChange(async (value) => {
          this.plugin.settings.cacheTimeout = value * 60000;
          await this.plugin.saveSettings();
          Logger.info('Cache timeout changed:', value);
        }));

    Logger.info('Settings tab display complete');
  }
}
