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
 * Log a debug message to the console if debug mode is enabled
 * Use sparingly for actionable debugging information
 * @param message The message to log
 * @param data Optional data to log
 */
export function logIfDebugModeEnabled(message: string, ...data: any[]): void {
  if (globalDebugMode) {
    console.log(`[RelatedNotes Debug] ${message}`, ...data);
  }
}

/**
 * Log metrics and statistics information
 * Always logged, used for important operational insights
 * @param message The message to log
 * @param data Optional data to log
 */
export function logMetrics(message: string, ...data: any[]): void {
  console.info(`[RelatedNotes] ${message}`, ...data);
}

/**
 * Log performance information
 * Always logged, used for performance tracking
 * @param message The message to log
 * @param data Optional data to log
 */
export function logPerformance(message: string, ...data: any[]): void {
  console.info(`[RelatedNotes Performance] ${message}`, ...data);
}

// Legacy constant for backward compatibility (will use global state)
export const DEBUG_MODE = false; // This is now deprecated, use isDebugMode() instead