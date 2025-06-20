/**
 * Release script for Obsidian Related Notes plugin
 * 
 * This script automates the release process following Obsidian's plugin guidelines:
 * 1. Increments version (patch, minor, or major)
 * 2. Updates manifest.json and package.json
 * 3. Creates and pushes a git tag
 * 4. GitHub Actions then creates the release with proper files
 * 
 * Usage:
 *   node scripts/release.mjs <patch|minor|major>
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Check if we have uncommitted changes
function checkGitStatus() {
  try {
    const status = execSync('git status --porcelain').toString().trim();
    if (status) {
      console.error('Error: You have uncommitted changes. Please commit or stash them before release.');
      process.exit(1);
    }
  } catch (error) {
    console.error('Error checking git status:', error.message);
    process.exit(1);
  }
}

// Check if manifest meets requirements
function validateManifest() {
  try {
    const manifestPath = path.join(rootDir, 'src', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // Check description length (250 char max)
    if (manifest.description.length > 250) {
      console.error(`Error: Description too long (${manifest.description.length} chars). Max 250 chars.`);
      process.exit(1);
    }

    // Check description ends with period
    if (!manifest.description.endsWith('.')) {
      console.error('Error: Description must end with a period.');
      process.exit(1);
    }

    // Check minAppVersion is set
    if (!manifest.minAppVersion) {
      console.error('Error: minAppVersion must be set in manifest.json');
      process.exit(1);
    }

    // Check id format
    if (!/^[a-z0-9-]+$/.test(manifest.id)) {
      console.error('Error: Plugin ID must contain only lowercase letters, numbers, and hyphens.');
      process.exit(1);
    }

    console.log('✅ Manifest validation passed');
  } catch (error) {
    console.error('Error validating manifest:', error.message);
    process.exit(1);
  }
}

// Bump version using npm
function bumpVersion(releaseType) {
  try {
    console.log(`Bumping ${releaseType} version...`);
    execSync(`npm version ${releaseType} --no-git-tag-version`);

    // Run the existing version bump script to update manifest.json and versions.json
    execSync('npm run version');

    // Get the new version from package.json
    const packageJson = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
    const newVersion = packageJson.version;
    console.log(`✅ Version bumped to ${newVersion}`);
    return newVersion;
  } catch (error) {
    console.error('Error bumping version:', error.message);
    process.exit(1);
  }
}

// Create and push git tag
function createAndPushTag(version) {
  try {
    // Commit the version changes
    execSync('git add package.json src/manifest.json manifest.json versions.json');
    execSync(`git commit -m "Release version ${version}"`);

    // Create tag
    console.log(`Creating git tag ${version}...`);
    execSync(`git tag ${version}`);

    // Push commit and tag
    console.log('Pushing to remote...');
    execSync('git push');
    execSync('git push --tags');
    console.log(`✅ Version ${version} pushed to remote`);
  } catch (error) {
    console.error('Error creating or pushing tag:', error.message);
    process.exit(1);
  }
}

// Run the release process
function release() {
  // Validate args
  const releaseType = process.argv[2];
  if (!['patch', 'minor', 'major'].includes(releaseType)) {
    console.error('Error: Please specify release type: patch, minor, or major');
    console.error('Usage: node scripts/release.mjs <patch|minor|major>');
    process.exit(1);
  }

  console.log('Starting release process...');

  // Check git status
  checkGitStatus();

  // Validate manifest.json
  validateManifest();

  // Bump version
  const newVersion = bumpVersion(releaseType);

  // Create and push git tag
  createAndPushTag(newVersion);

  console.log(`
✨ Release ${newVersion} complete! ✨
GitHub Actions will now create the release.
Check the status at: https://github.com/mrboxtobox/obsidian-related-notes/actions
`);
}

// Run the release process
release();