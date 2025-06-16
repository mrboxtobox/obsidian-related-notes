/**
 * @file Tests for URL sanitization and ReDoS prevention
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from './core';

describe('URL Sanitization and ReDoS Prevention', () => {
  describe('Normal URL Processing', () => {
    it('should handle normal HTTP URLs', () => {
      const result = tokenize('Visit https://example.com for more info');
      expect(result).toContain('visit');
      expect(result).toContain('more');
      expect(result).toContain('info');
      expect(result).toContain('https://example.com');
    });

    it('should handle normal file URLs', () => {
      const result = tokenize('Open file://path/to/document.txt');
      expect(result).toContain('open');
      expect(result).toContain('file://path/to/document.txt');
    });

    it('should handle file extensions', () => {
      const result = tokenize('See config.json and readme.md files');
      expect(result).toContain('see');
      expect(result).toContain('config.json');
      expect(result).toContain('readme.md');
      expect(result).toContain('files');
    });
  });

  describe('ReDoS Attack Prevention', () => {
    it('should handle extremely long URLs without hanging', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(10000);
      const text = `Visit ${longUrl} for info`;
      
      const startTime = Date.now();
      const result = tokenize(text);
      const endTime = Date.now();
      
      // Should complete within a reasonable time (5 seconds max)
      expect(endTime - startTime).toBeLessThan(5000);
      expect(result).toBeDefined();
    });

    it('should handle URLs with repeated patterns', () => {
      const maliciousUrl = 'https://example.com/' + 'a+'.repeat(1000);
      const text = `Visit ${maliciousUrl} for info`;
      
      const startTime = Date.now();
      const result = tokenize(text);
      const endTime = Date.now();
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result).toBeDefined();
    });

    it('should handle URLs with excessive dots', () => {
      const maliciousUrl = 'https://example.com/' + '.'.repeat(1000);
      const text = `Visit ${maliciousUrl} for info`;
      
      const startTime = Date.now();
      const result = tokenize(text);
      const endTime = Date.now();
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result).toBeDefined();
    });

    it('should handle URLs with repeated slashes', () => {
      const maliciousUrl = 'https://example.com' + '//'.repeat(500);
      const text = `Visit ${maliciousUrl} for info`;
      
      const startTime = Date.now();
      const result = tokenize(text);
      const endTime = Date.now();
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result).toBeDefined();
    });

    it('should handle many query parameters', () => {
      const maliciousUrl = 'https://example.com/?' + 'param=value&'.repeat(500);
      const text = `Visit ${maliciousUrl} for info`;
      
      const startTime = Date.now();
      const result = tokenize(text);
      const endTime = Date.now();
      
      // Should complete quickly
      expect(endTime - startTime).toBeLessThan(2000);
      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty strings', () => {
      const result = tokenize('');
      expect(result).toBe('');
    });

    it('should handle text with no URLs', () => {
      const result = tokenize('This is just regular text with no URLs');
      expect(result).toContain('regular');
      expect(result).toContain('text');
    });

    it('should handle malformed URLs gracefully', () => {
      const result = tokenize('Visit http:// or https:// for info');
      expect(result).toContain('visit');
      expect(result).toContain('info');
    });

    it('should handle very long text without URLs', () => {
      const longText = 'word '.repeat(10000);
      
      const startTime = Date.now();
      const result = tokenize(longText);
      const endTime = Date.now();
      
      // Should complete within reasonable time
      expect(endTime - startTime).toBeLessThan(5000);
      expect(result).toBeDefined();
      expect(result).toContain('word');
    });
  });

  describe('Mixed Content', () => {
    it('should handle text with both URLs and code blocks', () => {
      const result = tokenize('Visit https://example.com and run `npm install`');
      expect(result).toContain('visit');
      expect(result).toContain('https://example.com');
      expect(result).toContain('run');
      expect(result).toContain('npm install');
    });

    it('should handle multiple URLs in one text', () => {
      const result = tokenize('Go to https://site1.com and https://site2.com');
      expect(result).toContain('https://site1.com');
      expect(result).toContain('https://site2.com');
    });

    it('should handle URLs with different protocols', () => {
      const result = tokenize('See https://web.com and file://local.txt');
      expect(result).toContain('https://web.com');
      expect(result).toContain('file://local.txt');
    });
  });

  describe('Performance Tests', () => {
    it('should process normal-sized documents quickly', () => {
      const normalText = 'This is a normal document with some URLs like https://example.com and files like config.json. '.repeat(100);
      
      const startTime = Date.now();
      const result = tokenize(normalText);
      const endTime = Date.now();
      
      // Should complete very quickly for normal content
      expect(endTime - startTime).toBeLessThan(1000);
      expect(result).toBeDefined();
    });

    it('should handle large documents with many URLs', () => {
      const textWithManyUrls = Array(100).fill(0).map((_, i) => 
        `See https://example${i}.com for more info`
      ).join(' ');
      
      const startTime = Date.now();
      const result = tokenize(textWithManyUrls);
      const endTime = Date.now();
      
      // Should complete within reasonable time even with many URLs
      expect(endTime - startTime).toBeLessThan(3000);
      expect(result).toBeDefined();
    });
  });
});