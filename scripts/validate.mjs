/**
 * Validation script for Obsidian plugin
 * 
 * This script validates that the plugin meets Obsidian's requirements:
 * - Checks manifest.json properties
 * - Ensures README.md and LICENSE files exist
 * - Verifies styles.css exists
 * - Validates description length and format
 * 
 * Usage:
 *   node scripts/validate.mjs
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory name of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

// Colors for terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

// Track validation status
let errorCount = 0;
let warningCount = 0;

function error(message) {
  console.error(`${RED}ERROR: ${message}${RESET}`);
  errorCount++;
}

function warning(message) {
  console.warn(`${YELLOW}WARNING: ${message}${RESET}`);
  warningCount++;
}

function success(message) {
  console.log(`${GREEN}✓ ${message}${RESET}`);
}

// Check if required files exist
function checkRequiredFiles() {
  console.log('\n🔍 Checking required files...');
  
  const requiredFiles = [
    { path: 'README.md', message: 'README.md exists' },
    { path: 'LICENSE', message: 'LICENSE file exists' },
    { path: 'src/styles.css', message: 'styles.css exists in src directory' },
    { path: 'src/manifest.json', message: 'manifest.json exists in src directory' }
  ];
  
  for (const file of requiredFiles) {
    if (fs.existsSync(path.join(rootDir, file.path))) {
      success(file.message);
    } else {
      error(`Missing required file: ${file.path}`);
    }
  }
}

// Validate manifest.json
function validateManifest() {
  console.log('\n🔍 Validating manifest.json...');
  
  try {
    const manifestPath = path.join(rootDir, 'src', 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    
    // Check required fields
    const requiredFields = ['id', 'name', 'version', 'minAppVersion', 'author', 'description'];
    for (const field of requiredFields) {
      if (!manifest[field]) {
        error(`Missing required field in manifest.json: ${field}`);
      }
    }
    
    // Check id format
    if (manifest.id && !/^[a-z0-9-]+$/.test(manifest.id)) {
      error('Plugin ID must contain only lowercase letters, numbers, and hyphens');
    } else if (manifest.id) {
      success('Plugin ID format is valid');
    }
    
    // Check description length (250 char max)
    if (manifest.description) {
      if (manifest.description.length > 250) {
        error(`Description too long: ${manifest.description.length} chars (max 250)`);
      } else if (manifest.description.length > 200) {
        warning(`Description approaching max length: ${manifest.description.length}/250 chars`);
      } else {
        success(`Description length good: ${manifest.description.length}/250 chars`);
      }
      
      // Check description ends with period
      if (!manifest.description.endsWith('.')) {
        error('Description must end with a period');
      } else {
        success('Description ends with a period');
      }
      
      // Check if description starts with "This is a plugin"
      if (manifest.description.startsWith('This is a plugin')) {
        warning('Description should not start with "This is a plugin"');
      }
    }
    
    // Check minAppVersion is set properly
    if (manifest.minAppVersion) {
      const versionPattern = /^\d+\.\d+\.\d+$/;
      if (!versionPattern.test(manifest.minAppVersion)) {
        warning('minAppVersion should follow semantic versioning (e.g., 0.15.0)');
      } else {
        success('minAppVersion format is valid');
      }
    }
    
    // Verify fundingUrl is properly configured
    if (manifest.fundingUrl) {
      if (typeof manifest.fundingUrl === 'object') {
        success('fundingUrl is properly configured as an object');
      } else {
        error('fundingUrl should be an object with service names as keys');
      }
    }
    
    // Check isDesktopOnly field
    if (manifest.isDesktopOnly === undefined) {
      warning('isDesktopOnly field is missing. Set to false unless using Node.js-specific APIs');
    } else if (manifest.isDesktopOnly === true) {
      warning('Plugin is set as desktop-only. Make sure this is intentional if using Node.js-specific APIs');
    } else {
      success('Plugin is configured to work on mobile');
    }
  } catch (error) {
    console.error(`${RED}Error reading or parsing manifest.json:${RESET}`, error.message);
    errorCount++;
  }
}

// Check README content
function validateReadme() {
  console.log('\n🔍 Validating README.md...');
  
  try {
    const readmePath = path.join(rootDir, 'README.md');
    const readmeContent = fs.readFileSync(readmePath, 'utf8');
    
    // Check README length
    if (readmeContent.length < 500) {
      warning('README.md seems too short. Consider adding more documentation');
    } else {
      success('README.md has sufficient content');
    }
    
    // Check if README contains installation instructions
    if (!readmeContent.includes('Install') && !readmeContent.includes('installation')) {
      warning('README should include installation instructions');
    } else {
      success('README includes installation information');
    }
    
    // Check if README has usage section
    if (!readmeContent.includes('# Usage') && !readmeContent.includes('## Usage')) {
      warning('README should include a Usage section');
    } else {
      success('README includes Usage section');
    }
  } catch (error) {
    console.error(`${RED}Error reading README.md:${RESET}`, error.message);
    errorCount++;
  }
}

// Main validation function
function validatePlugin() {
  console.log('🔍 Starting Obsidian plugin validation...');
  
  checkRequiredFiles();
  validateManifest();
  validateReadme();
  
  // Print summary
  console.log('\n📋 Validation Summary:');
  if (errorCount === 0 && warningCount === 0) {
    console.log(`${GREEN}✅ All checks passed! Your plugin meets Obsidian's requirements.${RESET}`);
  } else {
    console.log(`${RED}❌ Found ${errorCount} error(s)${RESET} and ${YELLOW}${warningCount} warning(s)${RESET}`);
    
    if (errorCount > 0) {
      console.log(`${RED}Please fix the errors before submitting your plugin.${RESET}`);
    }
    
    if (warningCount > 0) {
      console.log(`${YELLOW}Consider addressing the warnings to improve your plugin.${RESET}`);
    }
  }
  
  // Exit with error code if there were errors
  if (errorCount > 0) {
    process.exit(1);
  }
}

// Run validation
validatePlugin();