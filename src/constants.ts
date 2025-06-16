/**
 * @file Configuration constants for the Related Notes plugin
 * Centralizes all magic numbers and configuration values
 */

/**
 * Text processing constants
 */
export const TEXT_PROCESSING = {
  /** Maximum character limit for processing large documents */
  LARGE_DOCUMENT_LIMIT: 10000,
  /** Minimum number of bits required for meaningful comparison */
  MIN_BITS_FOR_COMPARISON: 5,
  /** Character truncation fallback percentage */
  TRUNCATION_FALLBACK_RATIO: 0.9,
  /** Sentence boundary truncation ratio */
  SENTENCE_BOUNDARY_RATIO: 0.8,
  /** Word boundary truncation ratio */
  WORD_BOUNDARY_RATIO: 0.9,
} as const;

/**
 * N-gram and bloom filter constants
 */
export const BLOOM_FILTER = {
  /** Maximum bigrams for CJK text */
  MAX_BIGRAMS_CJK: 100,
  /** Maximum bigrams for non-CJK text */
  MAX_BIGRAMS_NON_CJK: 200,
  /** Default fixed bloom filter size */
  DEFAULT_FILTER_SIZE: 8192,
  /** Parameter update interval for adaptive parameters */
  PARAMETER_UPDATE_INTERVAL: 50,
  /** Bloom filter saturation threshold for similarity scaling */
  SATURATION_THRESHOLD: 0.4,
} as const;

/**
 * Batch processing constants
 */
export const BATCH_PROCESSING = {
  /** Files per batch for progressive indexing */
  FILES_PER_BATCH: 20,
  /** Minutes between progressive indexing batches */
  PROGRESSIVE_INTERVAL_MINUTES: 5,
  /** Milliseconds between file processing batches */
  PROCESS_INTERVAL_MS: 2000,
  /** Small batch size for UI responsiveness */
  SMALL_BATCH_SIZE: 3,
  /** Maximum initial index size */
  MAX_INITIAL_INDEX_SIZE: 1000,
  /** Percentage of vault for initial indexing */
  INITIAL_INDEX_PERCENTAGE: 0.1,
} as const;

/**
 * Stopwords and filtering constants
 */
export const WORD_FILTERING = {
  /** Maximum number of adaptive stopwords */
  MAX_STOPWORDS: 250,
  /** Threshold for common word detection */
  COMMON_WORDS_THRESHOLD: 0.5,
  /** Large vault threshold for sampling */
  LARGE_VAULT_THRESHOLD: 5000,
  /** Maximum sample size for large vaults */
  MAX_SAMPLE_SIZE: 1000,
} as const;

/**
 * Memory safety constants - hard limits to prevent crashes
 */
export const MEMORY_LIMITS = {
  /** Maximum documents to process before forced cleanup */
  MAX_DOCUMENTS_BEFORE_CLEANUP: 10000,
  /** Maximum memory usage estimate (MB) before cleanup */
  MAX_MEMORY_MB: 256,
  /** Maximum cache file size (MB) */
  MAX_CACHE_SIZE_MB: 50,
  /** Maximum single document size to process (MB) */
  MAX_DOCUMENT_SIZE_MB: 10,
} as const;

/**
 * Timing and performance constants - tuned to prevent CPU hogging
 */
export const TIMING = {
  /** Yield duration for async processing (ms) - generous to prevent blocking */
  YIELD_DURATION_MS: 16, // ~60fps frame budget
  /** Extended yield duration for heavy operations (ms) */
  EXTENDED_YIELD_DURATION_MS: 50,
  /** CPU throttling: max operations before mandatory yield */
  MAX_OPERATIONS_BEFORE_YIELD: 10,
  /** CPU throttling: minimum yield time during intensive operations */
  MIN_YIELD_TIME_MS: 16,
  /** Cache age threshold (30 days in milliseconds) */
  CACHE_AGE_THRESHOLD_MS: 30 * 24 * 60 * 60 * 1000,
  /** Milliseconds in one minute */
  MS_PER_MINUTE: 60 * 1000,
} as const;

/**
 * File operation retry constants - tuned for different system speeds
 */
export const FILE_OPERATIONS = {
  /** Maximum retry attempts for file operations */
  MAX_RETRIES: 3,
  /** Base timeout for file operations (ms) - increased for slow systems */
  TIMEOUT_MS: 15000,
  /** File read timeout (ms) - adaptive based on file size */
  READ_TIMEOUT_MS: 8000,
  /** Cache operation timeout (ms) - longer for complex cache writes */
  CACHE_TIMEOUT_MS: 20000,
  /** Base backoff delay (ms) */
  BASE_BACKOFF_MS: 1000,
  /** Maximum backoff delay (ms) */
  MAX_BACKOFF_MS: 8000,
  /** Timeout multiplier for large files (>1MB) */
  LARGE_FILE_TIMEOUT_MULTIPLIER: 2,
} as const;

/**
 * UI and display constants
 */
export const UI = {
  /** Maximum percentage display value */
  MAX_PERCENTAGE: 100,
  /** Debug log item length limit */
  DEBUG_LOG_ITEM_LIMIT: 10,
  /** Debug log sample size limit */
  DEBUG_SAMPLE_SIZE: 100,
  /** Top common words display limit */
  TOP_COMMON_WORDS_LIMIT: 50,
} as const;

/**
 * Cache and version constants
 */
export const CACHE = {
  /** Current cache version */
  VERSION: 1,
  /** Cache directory relative path */
  RELATIVE_PATH: '/plugins/obsidian-related-notes',
  /** Cache file name */
  FILENAME: '.bloom-filter-cache.json',
} as const;