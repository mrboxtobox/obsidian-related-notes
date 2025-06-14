#!/bin/bash

# Ensure the plugin directory exists in the test vault
TEST_VAULT_PLUGIN_DIR="./test-vault/.obsidian/plugins/obsidian-related-notes"
mkdir -p "$TEST_VAULT_PLUGIN_DIR"

# Copy the main files
cp main.js "$TEST_VAULT_PLUGIN_DIR/"
cp manifest.json "$TEST_VAULT_PLUGIN_DIR/"
cp styles.css "$TEST_VAULT_PLUGIN_DIR/"

echo "Copied plugin files to test vault: $TEST_VAULT_PLUGIN_DIR"

# If test-vault-env exists, copy there too
if [ -d "./test-vault-env" ]; then
  TEST_ENV_PLUGIN_DIR="./test-vault-env/.obsidian/plugins/obsidian-related-notes"
  mkdir -p "$TEST_ENV_PLUGIN_DIR"
  
  cp main.js "$TEST_ENV_PLUGIN_DIR/"
  cp manifest.json "$TEST_ENV_PLUGIN_DIR/"
  cp styles.css "$TEST_ENV_PLUGIN_DIR/"
  
  echo "Copied plugin files to test environment: $TEST_ENV_PLUGIN_DIR"
fi