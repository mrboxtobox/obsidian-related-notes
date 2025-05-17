#!/usr/bin/env python3
"""
Test script to analyze similarities between random pairs of files in the test corpus.
This gives us representative statistics about the SimHash similarity detection.
"""

import os
import random
import json
import re
from pathlib import Path
from collections import defaultdict, Counter
import statistics

# Test vault directory
test_vault_dir = Path("test-vault")

def parse_file_info(filename):
    """Extract category and other info from filename"""
    if filename.startswith("note_"):
        # Original files: note_000001_unknown_book_chapter_16.md
        match = re.match(r'note_(\d+)_unknown_book_chapter_(\d+|xx|conclusion)\.md', filename)
        if match:
            return {
                'type': 'original',
                'number': int(match.group(1)),
                'chapter': match.group(2),
                'category': 'literature'
            }
    elif filename.startswith("generated_note_"):
        # Generated files: generated_note_001001_fiction.md
        match = re.match(r'generated_note_(\d+)_(\w+)\.md', filename)
        if match:
            return {
                'type': 'generated',
                'number': int(match.group(1)),
                'category': match.group(2)
            }
    
    return {'type': 'unknown', 'category': 'unknown'}

def read_file_content(filepath):
    """Read and clean file content"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        # Remove markdown headers and metadata
        lines = content.split('\n')
        clean_lines = []
        for line in lines:
            if not line.startswith('#') and not line.startswith('From:') and not line.startswith('Category:') and not line.startswith('Generated:'):
                clean_lines.append(line)
        return ' '.join(clean_lines).strip()
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return ""

def compute_simple_similarity(text1, text2):
    """Compute a simple word-based similarity for comparison"""
    if not text1 or not text2:
        return 0.0
    
    # Simple word tokenization
    words1 = set(re.findall(r'\b\w+\b', text1.lower()))
    words2 = set(re.findall(r'\b\w+\b', text2.lower()))
    
    if not words1 or not words2:
        return 0.0
    
    # Jaccard similarity
    intersection = len(words1.intersection(words2))
    union = len(words1.union(words2))
    
    return intersection / union if union > 0 else 0.0

def simhash_hash(text, bits=64):
    """Simple SimHash implementation for comparison"""
    if not text:
        return 0
    
    # Simple hash function (FNV-1a)
    def hash_string(s):
        hash_val = 2166136261
        for char in s:
            hash_val ^= ord(char)
            hash_val = (hash_val * 16777619) % (2**32)
        return hash_val
    
    # Tokenize into words
    words = re.findall(r'\b\w+\b', text.lower())
    
    # Initialize bit vector
    v = [0] * bits
    
    for word in words:
        word_hash = hash_string(word)
        for i in range(bits):
            bit = (word_hash >> (i % 32)) & 1
            if bit:
                v[i] += 1
            else:
                v[i] -= 1
    
    # Generate final hash
    simhash = 0
    for i in range(bits):
        if v[i] > 0:
            simhash |= (1 << i)
    
    return simhash

def hamming_distance(hash1, hash2):
    """Calculate Hamming distance between two hashes"""
    xor = hash1 ^ hash2
    distance = 0
    while xor:
        distance += xor & 1
        xor >>= 1
    return distance

def simhash_similarity(text1, text2):
    """Calculate SimHash similarity between two texts"""
    hash1 = simhash_hash(text1)
    hash2 = simhash_hash(text2)
    distance = hamming_distance(hash1, hash2)
    # Convert to similarity (0-1 range)
    return 1 - (distance / 64)

def analyze_test_corpus(num_samples=1000):
    """Analyze similarities in the test corpus"""
    print(f"Analyzing test corpus with {num_samples} random pairs...")
    
    # Get all markdown files
    all_files = list(test_vault_dir.glob("*.md"))
    print(f"Found {len(all_files)} files in corpus")
    
    if len(all_files) < 2:
        print("Need at least 2 files to compare")
        return
    
    # Parse file information
    file_info = {}
    category_files = defaultdict(list)
    
    for filepath in all_files:
        info = parse_file_info(filepath.name)
        file_info[filepath] = info
        category_files[info['category']].append(filepath)
    
    print(f"\nCategory distribution:")
    for category, files in category_files.items():
        print(f"  {category}: {len(files)} files")
    
    # Sample pairs for analysis
    results = {
        'same_category': [],
        'different_category': [],
        'all_pairs': []
    }
    
    similarity_methods = {
        'word_jaccard': compute_simple_similarity,
        'simhash': simhash_similarity
    }
    
    print(f"\nSampling {num_samples} pairs...")
    
    for i in range(num_samples):
        if i % 100 == 0:
            print(f"  Processed {i}/{num_samples} pairs...")
        
        # Select two random files
        file1, file2 = random.sample(all_files, 2)
        info1 = file_info[file1]
        info2 = file_info[file2]
        
        # Read content
        content1 = read_file_content(file1)
        content2 = read_file_content(file2)
        
        if not content1 or not content2:
            continue
        
        # Calculate similarities with different methods
        similarities = {}
        for method_name, method_func in similarity_methods.items():
            sim = method_func(content1, content2)
            similarities[method_name] = sim
        
        pair_result = {
            'file1': file1.name,
            'file2': file2.name,
            'category1': info1['category'],
            'category2': info2['category'],
            'same_category': info1['category'] == info2['category'],
            'similarities': similarities
        }
        
        results['all_pairs'].append(pair_result)
        
        if info1['category'] == info2['category']:
            results['same_category'].append(pair_result)
        else:
            results['different_category'].append(pair_result)
    
    return results

def print_statistics(results):
    """Print detailed statistics about the similarities"""
    print(f"\n{'='*60}")
    print("SIMILARITY ANALYSIS RESULTS")
    print(f"{'='*60}")
    
    total_pairs = len(results['all_pairs'])
    same_cat_pairs = len(results['same_category'])
    diff_cat_pairs = len(results['different_category'])
    
    print(f"\nSample size: {total_pairs} pairs")
    print(f"Same category pairs: {same_cat_pairs}")
    print(f"Different category pairs: {diff_cat_pairs}")
    
    # Analyze each similarity method
    methods = ['word_jaccard', 'simhash']
    
    for method in methods:
        print(f"\n{'-'*40}")
        print(f"Method: {method.upper()}")
        print(f"{'-'*40}")
        
        # Overall statistics
        all_sims = [pair['similarities'][method] for pair in results['all_pairs']]
        same_sims = [pair['similarities'][method] for pair in results['same_category']]
        diff_sims = [pair['similarities'][method] for pair in results['different_category']]
        
        print(f"\nOverall similarities:")
        print(f"  Mean: {statistics.mean(all_sims):.3f}")
        print(f"  Median: {statistics.median(all_sims):.3f}")
        print(f"  Std Dev: {statistics.stdev(all_sims):.3f}")
        print(f"  Min: {min(all_sims):.3f}")
        print(f"  Max: {max(all_sims):.3f}")
        
        if same_sims:
            print(f"\nSame category pairs:")
            print(f"  Mean: {statistics.mean(same_sims):.3f}")
            print(f"  Median: {statistics.median(same_sims):.3f}")
            print(f"  Std Dev: {statistics.stdev(same_sims):.3f}")
        
        if diff_sims:
            print(f"\nDifferent category pairs:")
            print(f"  Mean: {statistics.mean(diff_sims):.3f}")
            print(f"  Median: {statistics.median(diff_sims):.3f}")
            print(f"  Std Dev: {statistics.stdev(diff_sims):.3f}")
        
        # Distribution analysis
        print(f"\nSimilarity distribution:")
        bins = [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
        hist = [0] * (len(bins) - 1)
        
        for sim in all_sims:
            for i in range(len(bins) - 1):
                if bins[i] <= sim < bins[i + 1]:
                    hist[i] += 1
                    break
            else:
                if sim == 1.0:
                    hist[-1] += 1
        
        for i in range(len(hist)):
            start, end = bins[i], bins[i + 1]
            count = hist[i]
            percentage = (count / len(all_sims)) * 100
            print(f"  {start:.1f}-{end:.1f}: {count:4d} pairs ({percentage:5.1f}%)")
        
        # Find most similar pairs
        print(f"\nTop 5 most similar pairs:")
        sorted_pairs = sorted(results['all_pairs'], 
                            key=lambda x: x['similarities'][method], 
                            reverse=True)
        
        for i, pair in enumerate(sorted_pairs[:5]):
            sim = pair['similarities'][method]
            same_cat = "✓" if pair['same_category'] else "✗"
            print(f"  {i+1}. {sim:.3f} [{same_cat}] {pair['category1']} vs {pair['category2']}")
            print(f"     {pair['file1']} <-> {pair['file2']}")

def save_results(results, filename="similarity_analysis.json"):
    """Save results to JSON file"""
    # Convert Path objects to strings for JSON serialization
    json_results = {
        'all_pairs': results['all_pairs'],
        'same_category': results['same_category'],
        'different_category': results['different_category']
    }
    
    with open(filename, 'w') as f:
        json.dump(json_results, f, indent=2)
    
    print(f"\nResults saved to {filename}")

def main():
    print("Test Corpus Similarity Analysis")
    print("===============================")
    
    if not test_vault_dir.exists():
        print(f"Error: Test vault directory {test_vault_dir} not found!")
        return
    
    # Run analysis
    num_samples = 2000  # Test 2000 random pairs
    results = analyze_test_corpus(num_samples)
    
    if not results or not results['all_pairs']:
        print("No valid pairs found for analysis")
        return
    
    # Print statistics
    print_statistics(results)
    
    # Save results
    save_results(results)
    
    print(f"\n{'='*60}")
    print("Analysis complete!")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()