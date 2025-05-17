/**
 * @file Simple logger utility with production mode removal
 */

'use strict';

// DEBUG_MODE is defined in esbuild.config.mjs
// Will be true for development builds, false for production builds
// esbuild will replace this with the appropriate value and
// tree-shake unused code in production

/**
 * Logger utility that only preserves errors in production
 */
export const Logger = {
  /**
   * Log debug messages (removed in production)
   */
  debug(...args: any[]): void {
    if (DEBUG_MODE) {
      console.debug(...args);
    }
  },

  /**
   * Log info messages (removed in production)
   */
  info(...args: any[]): void {
    if (DEBUG_MODE) {
      console.info(...args);
    }
  },

  /**
   * Log warnings (removed in production)
   */
  warn(...args: any[]): void {
    if (DEBUG_MODE) {
      console.warn(...args);
    }
  },

  /**
   * Log errors (preserved in production)
   */
  error(...args: any[]): void {
    console.error(...args);
  }
};