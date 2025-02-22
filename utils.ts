/**
 * @file Utility functions for the Related Notes plugin.
 */

/**
 * Simple word stemmer that handles common English word endings
 */
export function simpleStem(word: string): string {
  if (word.length < 3) return word;

  word = word.toLowerCase().replace(/['']s?$/g, '');

  // Quick vowel check helper
  const isVowel = (c: string) => /[aeiou]/i.test(c);

  // Count syllables inline
  const syllables = word.split('').reduce((count, char, i, arr) =>
    count + (isVowel(char) && !isVowel(arr[i - 1] || '') ? 1 : 0), 0);

  // Handle doubled consonants
  if (/([bcdfghjklmnpqrstvwxz])\1$/.test(word)) {
    word = word.slice(0, -1);
  }

  // Handle special cases
  const specials: { [key: string]: string } = {
    'having': 'have', 'being': 'be', 'going': 'go', 'doing': 'do',
    'saying': 'say', 'lives': 'life', 'wives': 'wife', 'leaves': 'leaf',
    'tries': 'try', 'taxes': 'tax', 'uses': 'use', 'becomes': 'become',
    'makes': 'make', 'taking': 'take', 'looking': 'look', 'coming': 'come',
    'dying': 'die', 'lying': 'lie', 'tying': 'tie'
  };
  if (specials[word]) return specials[word];

  // Process suffixes
  const rules = [
    { s: 'ational', r: 'ate' }, { s: 'ization', r: 'ize' },
    { s: 'fulness', r: 'ful' }, { s: 'ousness', r: 'ous' },
    { s: 'iveness', r: 'ive' }, { s: 'ality', r: 'al' },
    { s: 'ously', r: 'ous' }, { s: 'ently', r: 'ent' },
    { s: 'ably', r: 'able' },
    { s: 'ing', r: '', c: (w: string) => w.length > 4 && syllables > 1 },
    { s: 'ying', r: 'y' },
    { s: 'ed', r: '', c: (w: string) => w.length > 3 && /[bcdfghjklmnpqrstvwxz]ed$/.test(w) },
    { s: 'ies', r: 'y' }, { s: 'ied', r: 'y' },
    { s: 'ement', r: '' }, { s: 'ments', r: '' }, { s: 'ness', r: '' },
    { s: 'ational', r: 'ate' }, { s: 'tional', r: 'tion' },
    { s: 'enci', r: 'ence' }, { s: 'anci', r: 'ance' },
    { s: 'izer', r: 'ize' }, { s: 'ator', r: 'ate' },
    { s: 'able', r: '' }, { s: 'ible', r: '' },
    { s: 'tion', r: 't' }, { s: 'sion', r: 's' },
    { s: 'ful', r: '' }, { s: 'ant', r: '' }, { s: 'ent', r: '' },
    { s: 'ism', r: '' }, { s: 'ist', r: '' }, { s: 'ity', r: '' },
    { s: 'ive', r: '' }, { s: 'ize', r: '' }, { s: 'ous', r: '' },
    { s: 's', r: '', c: (w: string) => w.length > 3 && !/[aeiou]s$/.test(w) && !/ss$/.test(w) }
  ];

  for (const { s: suffix, r: replacement, c: condition } of rules) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length) + replacement;
      if (!condition || condition(stem)) {
        if (stem.length > 1 && /([bcdfghjklmnpqrstvwxz])\1$/.test(stem)) {
          return stem.slice(0, -1);
        }
        return stem;
      }
    }
  }

  // Final y/i handling
  if (/[bcdfghjklmnpqrstvwxz]y$/.test(word)) {
    return word.slice(0, -1) + 'i';
  }

  return word;
}

/**
 * Log levels for the Related Notes plugin.
 */
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

/**
 * Logging utility for the Related Notes plugin.
 */
export class Logger {
  private static logLevel: LogLevel = LogLevel.ERROR;

  static setLogLevel(level: LogLevel) {
    this.logLevel = level;
  }

  static error(message: string, error?: any) {
    if (this.logLevel >= LogLevel.ERROR) {
      console.error(`[Related Notes] ${message}`, error || '');
    }
  }

  static warn(message: string, data?: any) {
    if (this.logLevel >= LogLevel.WARN) {
      console.warn(`[Related Notes] ${message}`, data || '');
    }
  }

  static info(message: string, data?: any) {
    if (this.logLevel >= LogLevel.INFO) {
      console.info(`[Related Notes] ${message}`, data || '');
    }
  }

  static debug(message: string, data?: any) {
    if (this.logLevel >= LogLevel.DEBUG) {
      console.debug(`[Related Notes] ${message}`, data || '');
    }
  }
}
