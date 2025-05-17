/**
 * @file Enhanced logger utility with production mode removal and context prefixing
 */

'use strict';

// DEBUG_MODE is defined in esbuild.config.mjs
// Will be true for development builds, false for production builds
// esbuild will replace this with the appropriate value and
// tree-shake unused code in production

// DEBUG_MODE is defined by esbuild at build time
// This declaration ensures TypeScript recognizes it
declare var DEBUG_MODE: boolean;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger utility with context-awareness and production stripping
 */
export class Logger {
  private context: string;
  private static timestampEnabled = true;
  
  /**
   * Create a new logger instance with the specified context
   * @param context Module or component name for log prefixing
   */
  constructor(context: string) {
    this.context = context;
  }
  
  /**
   * Enable or disable timestamps in logs
   */
  static setTimestampEnabled(enabled: boolean): void {
    Logger.timestampEnabled = enabled;
  }
  
  /**
   * Format log message with context and optional timestamp
   */
  private formatMessage(level: LogLevel, args: any[]): any[] {
    const prefix = [];
    
    if (Logger.timestampEnabled) {
      const now = new Date();
      const timestamp = now.toISOString().split('T')[1].slice(0, 12);
      prefix.push(`[${timestamp}]`);
    }
    
    prefix.push(`[${this.context}]`);
    prefix.push(`[${level.toUpperCase()}]`);
    
    if (typeof args[0] === 'string') {
      return [prefix.join(' ') + ' ' + args[0], ...args.slice(1)];
    } else {
      return [...prefix, ...args];
    }
  }

  /**
   * Log debug messages (removed in production)
   */
  debug(...args: any[]): void {
    if (DEBUG_MODE) {
      console.debug(...this.formatMessage('debug', args));
    }
  }

  /**
   * Log info messages (removed in production)
   */
  info(...args: any[]): void {
    if (DEBUG_MODE) {
      console.info(...this.formatMessage('info', args));
    }
  }

  /**
   * Log warnings (removed in production)
   */
  warn(...args: any[]): void {
    if (DEBUG_MODE) {
      console.warn(...this.formatMessage('warn', args));
    }
  }

  /**
   * Log errors (preserved in production)
   */
  error(...args: any[]): void {
    console.error(...this.formatMessage('error', args));
  }
  
  /**
   * Create a child logger with extended context
   */
  child(subContext: string): Logger {
    return new Logger(`${this.context}.${subContext}`);
  }
}

/**
 * Create a logger with the specified context
 */
export function getLogger(context: string): Logger {
  return new Logger(context);
}