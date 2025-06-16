/**
 * @file Centralized error handling and logging utilities
 */

import { isDebugMode } from './logging';

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

/**
 * Error categories for better organization
 */
export enum ErrorCategory {
  FILE_OPERATION = 'file_operation',
  CACHE_OPERATION = 'cache_operation',
  INDEXING = 'indexing',
  SIMILARITY_COMPUTATION = 'similarity_computation',
  UI = 'ui',
  CONFIGURATION = 'configuration',
  VALIDATION = 'validation',
  PERFORMANCE = 'performance'
}

/**
 * Structured error information
 */
export interface ErrorInfo {
  message: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  context?: Record<string, any>;
  originalError?: Error;
  timestamp?: number;
  stack?: string;
}

/**
 * Error handler configuration
 */
interface ErrorHandlerConfig {
  logToConsole: boolean;
  includeStackTrace: boolean;
  maxContextSize: number;
}

/**
 * Centralized error handler class
 */
export class ErrorHandler {
  private static instance: ErrorHandler | null = null;
  private config: ErrorHandlerConfig;
  private errorCount: Map<ErrorCategory, number> = new Map();

  private constructor(config: Partial<ErrorHandlerConfig> = {}) {
    this.config = {
      logToConsole: true,
      includeStackTrace: true,
      maxContextSize: 1000,
      ...config
    };
  }

  /**
   * Get the singleton instance of ErrorHandler
   */
  public static getInstance(config?: Partial<ErrorHandlerConfig>): ErrorHandler {
    if (!ErrorHandler.instance) {
      ErrorHandler.instance = new ErrorHandler(config);
    }
    return ErrorHandler.instance;
  }

  /**
   * Handle an error with structured logging
   */
  public handleError(errorInfo: ErrorInfo): void {
    // Add timestamp if not provided
    if (!errorInfo.timestamp) {
      errorInfo.timestamp = Date.now();
    }

    // Increment error count for this category
    const currentCount = this.errorCount.get(errorInfo.category) || 0;
    this.errorCount.set(errorInfo.category, currentCount + 1);

    // Log based on severity and configuration
    this.logError(errorInfo);

    // For critical errors, also show in console regardless of debug mode
    if (errorInfo.severity === ErrorSeverity.CRITICAL) {
      console.error(`[RelatedNotes CRITICAL] ${errorInfo.message}`, errorInfo.originalError);
    }
  }

  /**
   * Log the error based on configuration and debug mode
   */
  private logError(errorInfo: ErrorInfo): void {
    if (!this.config.logToConsole && !isDebugMode()) {
      return;
    }

    const prefix = `[RelatedNotes:${errorInfo.category}:${errorInfo.severity}]`;
    const timestamp = new Date(errorInfo.timestamp!).toISOString();
    
    let logMessage = `${prefix} ${timestamp} - ${errorInfo.message}`;

    // Add context if available and not too large
    if (errorInfo.context) {
      const contextStr = JSON.stringify(errorInfo.context);
      if (contextStr.length <= this.config.maxContextSize) {
        logMessage += ` | Context: ${contextStr}`;
      } else {
        logMessage += ` | Context: [Too large to display - ${contextStr.length} chars]`;
      }
    }

    // Choose appropriate console method based on severity
    switch (errorInfo.severity) {
      case ErrorSeverity.CRITICAL:
        console.error(logMessage, errorInfo.originalError);
        break;
      case ErrorSeverity.HIGH:
        console.error(logMessage, errorInfo.originalError);
        break;
      case ErrorSeverity.MEDIUM:
        console.warn(logMessage, errorInfo.originalError);
        break;
      case ErrorSeverity.LOW:
        if (isDebugMode()) {
          console.info(logMessage, errorInfo.originalError);
        }
        break;
    }

    // Add stack trace if configured and available
    if (this.config.includeStackTrace && errorInfo.originalError?.stack) {
      console.group('Stack trace:');
      console.info(errorInfo.originalError.stack);
      console.groupEnd();
    }
  }

  /**
   * Get error statistics
   */
  public getErrorStats(): Record<string, number> {
    const stats: Record<string, number> = {};
    for (const [category, count] of this.errorCount.entries()) {
      stats[category] = count;
    }
    return stats;
  }

  /**
   * Reset error statistics
   */
  public resetStats(): void {
    this.errorCount.clear();
  }

  /**
   * Update configuration
   */
  public updateConfig(newConfig: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }
}

/**
 * Convenience functions for common error scenarios
 */

/**
 * Handle file operation errors
 */
export function handleFileError(error: Error, operation: string, filePath?: string): void {
  ErrorHandler.getInstance().handleError({
    message: `File operation failed: ${operation}`,
    category: ErrorCategory.FILE_OPERATION,
    severity: ErrorSeverity.MEDIUM,
    context: { operation, filePath },
    originalError: error
  });
}

/**
 * Handle cache operation errors
 */
export function handleCacheError(error: Error, operation: string, details?: Record<string, any>): void {
  ErrorHandler.getInstance().handleError({
    message: `Cache operation failed: ${operation}`,
    category: ErrorCategory.CACHE_OPERATION,
    severity: ErrorSeverity.MEDIUM,
    context: { operation, ...details },
    originalError: error
  });
}

/**
 * Handle indexing errors
 */
export function handleIndexingError(error: Error, documentId?: string, details?: Record<string, any>): void {
  ErrorHandler.getInstance().handleError({
    message: `Indexing operation failed`,
    category: ErrorCategory.INDEXING,
    severity: ErrorSeverity.HIGH,
    context: { documentId, ...details },
    originalError: error
  });
}

/**
 * Handle similarity computation errors
 */
export function handleSimilarityError(error: Error, doc1?: string, doc2?: string): void {
  ErrorHandler.getInstance().handleError({
    message: `Similarity computation failed`,
    category: ErrorCategory.SIMILARITY_COMPUTATION,
    severity: ErrorSeverity.MEDIUM,
    context: { doc1, doc2 },
    originalError: error
  });
}

/**
 * Handle UI errors
 */
export function handleUIError(error: Error, component?: string, action?: string): void {
  ErrorHandler.getInstance().handleError({
    message: `UI operation failed`,
    category: ErrorCategory.UI,
    severity: ErrorSeverity.LOW,
    context: { component, action },
    originalError: error
  });
}

/**
 * Handle configuration errors
 */
export function handleConfigError(error: Error, setting?: string): void {
  ErrorHandler.getInstance().handleError({
    message: `Configuration error`,
    category: ErrorCategory.CONFIGURATION,
    severity: ErrorSeverity.HIGH,
    context: { setting },
    originalError: error
  });
}

/**
 * Handle validation errors
 */
export function handleValidationError(error: Error, validationType?: string, value?: any): void {
  ErrorHandler.getInstance().handleError({
    message: `Validation failed`,
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.MEDIUM,
    context: { validationType, value: typeof value === 'string' ? value.substring(0, 100) : value },
    originalError: error
  });
}

/**
 * Handle performance-related errors
 */
export function handlePerformanceError(error: Error, operation?: string, duration?: number): void {
  ErrorHandler.getInstance().handleError({
    message: `Performance issue detected`,
    category: ErrorCategory.PERFORMANCE,
    severity: ErrorSeverity.MEDIUM,
    context: { operation, duration },
    originalError: error
  });
}

/**
 * Create an error from a message and optional context
 */
export function createError(message: string, context?: Record<string, any>): Error {
  const error = new Error(message);
  if (context) {
    (error as any).context = context;
  }
  return error;
}