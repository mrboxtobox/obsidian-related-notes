/**
 * @file Tests for core functionality
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from '../src/core';

describe('Core Tokenization', () => {
  describe('Basic Functionality', () => {
    it('should tokenize and remove stop words', () => {
      const result = tokenize('The quick brown fox jumps over the lazy dog');
      expect(result).toContain('quick');
      expect(result).toContain('brown');
      expect(result).toContain('jump'); // stemmed
      expect(result).not.toContain('the');
      expect(result).not.toContain('over');
    });

    it('should handle empty input', () => {
      expect(tokenize('')).toBe('');
      expect(tokenize(null as any)).toBe('');
      expect(tokenize(undefined as any)).toBe('');
    });

    it('should preserve meaningful content', () => {
      const result = tokenize('programming language documentation');
      expect(result).toContain('programm'); // stemmed
      expect(result).toContain('languag'); // stemmed  
      expect(result).toContain('document'); // stemmed
    });
  });

  describe('Stemming', () => {
    it('should stem common suffixes', () => {
      const result = tokenize('running walked cats');
      expect(result).toContain('runn');
      expect(result).toContain('walk');
      expect(result).toContain('cat');
    });
  });

  describe('Technical Content', () => {
    it('should preserve code and URLs', () => {
      const result = tokenize('Check `function()` and visit https://example.com');
      expect(result).toContain('function()');
      expect(result).toContain('https://example.com');
      expect(result).toContain('check');
      expect(result).toContain('visit');
    });

    it('should preserve file paths', () => {
      const result = tokenize('Open config.js file');
      expect(result).toContain('config.js');
      expect(result).toContain('open');
      expect(result).toContain('file');
    });
  });

  describe('CJK Text', () => {
    it('should handle Chinese text', () => {
      const result = tokenize('这是中文测试');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('这');
      expect(result).toContain('是');
    });

    it('should handle Japanese text', () => {
      const result = tokenize('これは日本語です');
      expect(result.length).toBeGreaterThan(0);
      expect(result).toContain('こ');
      expect(result).toContain('れ');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed input gracefully', () => {
      expect(() => tokenize('normal text')).not.toThrow();
      expect(() => tokenize('text with 🦊 emoji')).not.toThrow();
    });

    it('should handle large text efficiently', () => {
      const largeText = 'word '.repeat(10000);
      const start = Date.now();
      const result = tokenize(largeText);
      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
      expect(result).toContain('word');
    });
  });
});