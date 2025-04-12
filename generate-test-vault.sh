#\!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Create and activate virtual environment if it doesn't exist
if [ \! -d "test-vault-env" ]; then
  echo "Creating virtual environment..."
  python3 -m venv test-vault-env
fi

# Clean test vault
rm -rf test-vault
mkdir -p test-vault

# Run the generator script
echo "Activating virtual environment and installing dependencies..."
source test-vault-env/bin/activate
pip install requests beautifulsoup4

echo "Running gutenberg_downloader.py to generate test vault..."
python test-vault-env/gutenberg_downloader.py

echo "Test vault generation complete\!"

deactivate
