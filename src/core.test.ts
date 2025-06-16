/**
 * @file Tests for core functionality
 */

import { describe, it, expect } from 'vitest';
import { tokenize } from './core';

describe('Core Tokenization', () => {
  describe('Basic Tokenization', () => {
    it('should tokenize simple English text', () => {
      const result = tokenize('The quick brown fox jumps over the lazy dog');
      expect(result).toContain('quick');
      expect(result).toContain('brown');
      expect(result).toContain('jump'); // stemmed from 'jumps'
      expect(result).toContain('lazy');
      expect(result).toContain('dog');
      expect(result).not.toContain('the'); // stop word
      expect(result).not.toContain('over'); // stop word
    });

    it('should handle empty strings', () => {
      const result = tokenize('');
      expect(result).toBe('');
    });

    it('should handle null and undefined', () => {
      const result1 = tokenize(null as any);
      expect(result1).toBe('');
      
      const result2 = tokenize(undefined as any);
      expect(result2).toBe('');
    });

    it('should remove stop words', () => {
      const result = tokenize('The cat is on the mat');
      expect(result).not.toContain('the');
      expect(result).not.toContain('is');
      expect(result).not.toContain('on');
      expect(result).toContain('cat');
      expect(result).toContain('mat');
    });

    it('should filter short words', () => {
      const result = tokenize('I am a programmer');
      expect(result).not.toContain('I');
      expect(result).not.toContain('am');
      expect(result).not.toContain('a');
      expect(result).toContain('programmer');
    });
  });

  describe('Stemming', () => {
    it('should stem -ing words', () => {
      const result = tokenize('running jumping swimming');
      expect(result).toContain('runn');
      expect(result).toContain('jump');
      expect(result).toContain('swimm');
    });

    it('should stem -ed words', () => {
      const result = tokenize('walked talked jumped');
      expect(result).toContain('walk');
      expect(result).toContain('talk');
      expect(result).toContain('jump');
    });

    it('should stem -s words', () => {
      const result = tokenize('cats dogs birds');
      expect(result).toContain('cat');
      expect(result).toContain('dog');
      expect(result).toContain('bird');
    });

    it('should stem -es words', () => {
      const result = tokenize('boxes dishes');
      expect(result).toContain('box');
      expect(result).toContain('dish');
    });

    it('should stem -ies words', () => {
      const result = tokenize('flies tries');
      expect(result).toContain('fly');
      expect(result).toContain('try');
    });

    it('should stem -ly words', () => {
      const result = tokenize('quickly slowly');
      expect(result).toContain('quick');
      expect(result).toContain('slow');
    });

    it('should not stem technical terms', () => {
      const result = tokenize('config.js index.html');
      expect(result).toContain('config.js');
      expect(result).toContain('index.html');
    });
  });

  describe('Contractions', () => {
    it('should expand contractions', () => {
      const result = tokenize("don't can't won't");
      expect(result).toContain('not');
      expect(result).not.toContain("don't");
      expect(result).not.toContain("can't");
      expect(result).not.toContain("won't");
    });

    it('should handle possessives', () => {
      const result = tokenize("John's car");
      expect(result).toContain('john');
      expect(result).toContain('car');
    });

    it('should handle various contractions', () => {
      const result = tokenize("I'm you're he's she's we're they're");
      expect(result).toContain('are');
      expect(result).not.toContain("I'm");
      expect(result).not.toContain("you're");
    });
  });

  describe('Code and Technical Content', () => {
    it('should preserve code blocks', () => {
      const result = tokenize('Check this `function()` and ```const x = 5;```');
      expect(result).toContain('function()');
      expect(result).toContain('const x = 5;');
    });

    it('should preserve URLs', () => {
      const result = tokenize('Visit https://example.com for more info');
      expect(result).toContain('https://example.com');
      expect(result).toContain('visit');
      expect(result).toContain('more');
      expect(result).toContain('info');
    });

    it('should preserve file paths', () => {
      const result = tokenize('Open file.js and config.json');
      expect(result).toContain('file.js');
      expect(result).toContain('config.json');
      expect(result).toContain('open');
    });

    it('should handle underscores and hyphens', () => {
      const result = tokenize('variable_name and kebab-case');
      expect(result).toContain('variable_name');
      expect(result).toContain('kebab-case');
    });
  });

  describe('CJK Text Processing', () => {
    it('should handle Chinese text', () => {
      const result = tokenize('这是一个测试文本');
      expect(result).toContain('这');
      expect(result).toContain('是');
      expect(result).toContain('一');
      expect(result).toContain('个');
    });

    it('should handle Japanese text', () => {
      const result = tokenize('これはテストです');
      expect(result).toContain('こ');
      expect(result).toContain('れ');
      expect(result).toContain('は');
      expect(result).toContain('テ');
      expect(result).toContain('ス');
      expect(result).toContain('ト');
    });

    it('should handle Korean text', () => {
      const result = tokenize('이것은 테스트입니다');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should create CJK bigrams', () => {
      const result = tokenize('测试');
      expect(result).toContain('测');
      expect(result).toContain('试');
      expect(result).toContain('测试'); // bigram
    });

    it('should handle mixed CJK and Latin text', () => {
      const result = tokenize('Hello 世界 World');
      expect(result).toContain('hello');
      expect(result).toContain('world');
      expect(result).toContain('世');
      expect(result).toContain('界');
    });
  });

  describe('Special Characters and Edge Cases', () => {
    it('should handle punctuation', () => {
      const result = tokenize('Hello, world! How are you?');
      expect(result).toContain('hello');
      expect(result).toContain('world');
      expect(result).not.toContain(',');
      expect(result).not.toContain('!');
      expect(result).not.toContain('?');
    });

    it('should handle numbers', () => {
      const result = tokenize('The year 2023 was great');
      expect(result).toContain('year');
      expect(result).toContain('2023');
      expect(result).toContain('great');
    });

    it('should handle mixed content', () => {
      const result = tokenize('Programming in Python 3.9: def function(): return "Hello"');
      expect(result).toContain('programming');
      expect(result).toContain('python');
      expect(result).toContain('def function(): return "Hello"'); // code block
    });

    it('should handle very long text', () => {
      const longText = 'word '.repeat(1000);
      const result = tokenize(longText);
      expect(result).toContain('word');
      expect(result.split(' ').length).toBeGreaterThan(0);
    });

    it('should handle text with excessive whitespace', () => {
      const result = tokenize('  hello    world   ');
      expect(result).toContain('hello');
      expect(result).toContain('world');
    });

    it('should handle newlines and tabs', () => {
      const result = tokenize('line1\nline2\tline3');
      expect(result).toContain('line1');
      expect(result).toContain('line2');
      expect(result).toContain('line3');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed input gracefully', () => {
      const result = tokenize('```malformed code block');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should handle circular references in regex', () => {
      const result = tokenize('((((test))))');
      expect(result).toContain('test');
    });

    it('should handle extremely long URLs', () => {
      const longUrl = 'https://example.com/' + 'a'.repeat(1000);
      const result = tokenize(`Visit ${longUrl} for info`);
      expect(result).toContain(longUrl);
      expect(result).toContain('visit');
      expect(result).toContain('info');
    });
  });

  describe('Performance', () => {
    it('should tokenize large documents efficiently', () => {
      const largeText = 'This is a test sentence with many words. '.repeat(1000);
      const startTime = Date.now();
      const result = tokenize(largeText);
      const endTime = Date.now();
      
      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle multiple CJK characters efficiently', () => {
      const cjkText = '这是一个很长的中文文本，用来测试性能。'.repeat(100);
      const startTime = Date.now();
      const result = tokenize(cjkText);
      const endTime = Date.now();
      
      expect(result).toBeDefined();
      expect(endTime - startTime).toBeLessThan(1000); // Should complete within 1 second
    });
  });
});