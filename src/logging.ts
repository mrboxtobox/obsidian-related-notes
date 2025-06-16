/**
 * Logging utilities for the Related Notes plugin
 */

// Set this to true to enable debug logging
export const DEBUG_MODE = false;

/**
 * Log a message to the console if debug mode is enabled
 * @param message The message to log
 * @param data Optional data to log
 */
export function log(message: string, ...data: any[]): void {
  if (DEBUG_MODE) {
    console.log(`[RelatedNotes] ${message}`, ...data);
  }
}