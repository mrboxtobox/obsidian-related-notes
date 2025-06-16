// Test script to understand tokenize function outputs
import { tokenize } from './src/core.js';

console.log('Test 1 - short words:', JSON.stringify(tokenize('I am a programmer')));
console.log('Test 2 - ies words:', JSON.stringify(tokenize('flies tries')));
console.log('Test 3 - technical terms:', JSON.stringify(tokenize('config.js index.html')));
console.log('Test 4 - contractions:', JSON.stringify(tokenize("don't can't won't")));
console.log('Test 5 - possessives:', JSON.stringify(tokenize("I'm you're he's she's we're they're")));
console.log('Test 6 - code blocks:', JSON.stringify(tokenize('Check this `function()` and ```const x = 5;```')));
console.log('Test 7 - URLs:', JSON.stringify(tokenize('Visit https://example.com for more info')));
console.log('Test 8 - Korean:', JSON.stringify(tokenize('이것은 테스트입니다')));
console.log('Test 9 - mixed content:', JSON.stringify(tokenize('Programming in Python 3.9: def function(): return "Hello"')));
console.log('Test 10 - long URL:', JSON.stringify(tokenize('Visit https://example.com/' + 'a'.repeat(1000) + ' for info')));