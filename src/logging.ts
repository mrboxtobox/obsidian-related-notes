/**
 * Logging utilities for the Related Notes plugin
 */

// Global debug mode state - will be updated by the plugin
let globalDebugMode = false;

/**
 * Set the debug mode state
 * @param enabled Whether debug mode should be enabled
 */
export function setDebugMode(enabled: boolean): void {
  globalDebugMode = enabled;
}

/**
 * Get the current debug mode state
 * @returns Whether debug mode is currently enabled
 */
export function isDebugMode(): boolean {
  return globalDebugMode;
}

/**
 * Log a message to the console if debug mode is enabled
 * @param message The message to log
 * @param data Optional data to log
 */
export function logIfDebugModeEnabled(message: string, ...data: any[]): void {
  if (globalDebugMode) {
    console.log(`[RelatedNotes] ${message}`, ...data);
  }
}

// Legacy constant for backward compatibility (will use global state)
export const DEBUG_MODE = false; // This is now deprecated, use isDebugMode() instead