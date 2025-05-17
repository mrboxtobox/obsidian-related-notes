#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Number of notes to generate (default: 1000 for quick testing)
NUM_NOTES=${1:-1000}

# Create and activate virtual environment if it doesn't exist
if [ ! -d "test-vault-env" ]; then
  echo "Creating virtual environment..."
  python3 -m venv test-vault-env
fi

# Clean test vault
rm -rf test-vault
mkdir -p test-vault

# Update the script to generate the requested number of notes
sed -i.bak "s/total_notes=[0-9]\+/total_notes=$NUM_NOTES/" test-vault-env/gutenberg_downloader.py

# Run the generator script
echo "Activating virtual environment and installing dependencies..."
source test-vault-env/bin/activate
pip install requests beautifulsoup4

echo "Running gutenberg_downloader.py to generate $NUM_NOTES test notes..."
python test-vault-env/gutenberg_downloader.py

echo "Test vault generation complete with $NUM_NOTES notes!"
echo "Notes are organized by book and chapter to ensure similar content is named similarly."

deactivate