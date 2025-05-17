#!/usr/bin/env python3
"""
Expand the test corpus to have many more files for testing similarity detection.
"""

import os
import random
from pathlib import Path

# Base directory
test_vault_dir = Path("test-vault")

# Sample content chunks from different genres
fiction_chunks = [
    "The old mansion stood silently against the dark sky, its windows like hollow eyes watching the approaching storm.",
    "Sarah walked through the misty garden, her footsteps echoing on the cobblestone path as shadows danced around her.",
    "The detective examined the crime scene carefully, noting every detail that might lead to solving this mysterious case.",
    "In the distant kingdom, dragons soared through cloudy skies while brave knights prepared for their next quest.",
    "The spaceship traveled through the vast emptiness of space, carrying its crew toward an unknown planet.",
    "Elizabeth received the letter with trembling hands, knowing it would change her life forever.",
    "The professor's laboratory was filled with strange inventions and bubbling chemicals that glowed in the dim light.",
    "Through the thick forest, the adventurers searched for the ancient treasure that legends spoke of.",
    "The small village by the sea had always been peaceful until the mysterious stranger arrived one stormy night.",
    "In the library's forbidden section, ancient books held secrets that few were brave enough to uncover."
]

science_chunks = [
    "The quantum mechanics experiment revealed fascinating properties of particle behavior at the subatomic level.",
    "Climate change affects global weather patterns, causing significant shifts in temperature and precipitation worldwide.",
    "DNA sequencing technology has revolutionized our understanding of genetic diseases and hereditary traits.",
    "The theory of relativity explains how time and space are interconnected in ways that challenge common intuition.",
    "Artificial intelligence algorithms continue to evolve, showing remarkable capabilities in pattern recognition and learning.",
    "Renewable energy sources like solar and wind power offer sustainable alternatives to fossil fuels.",
    "The human brain contains billions of neurons that form complex networks responsible for consciousness and thought.",
    "Chemical reactions involve the breaking and forming of bonds between atoms and molecules.",
    "Evolution through natural selection explains the diversity of life forms we observe in nature today.",
    "Astronomical observations reveal distant galaxies that formed billions of years ago in the early universe."
]

philosophy_chunks = [
    "The nature of consciousness remains one of philosophy's most enduring and perplexing questions for scholars.",
    "Ethical dilemmas often arise when personal values conflict with societal expectations and moral obligations.",
    "Free will versus determinism represents a fundamental debate about human agency and responsibility.",
    "The meaning of existence has been contemplated by thinkers throughout history across all cultures.",
    "Knowledge and truth are concepts that philosophers have analyzed through various epistemological frameworks.",
    "Justice requires balancing individual rights with collective welfare in complex social situations.",
    "Beauty and aesthetics involve subjective experiences that seem to have objective underlying principles.",
    "Language shapes thought in ways that influence how we perceive and understand reality around us.",
    "The relationship between mind and body poses interesting questions about consciousness and identity.",
    "Time and space form the fundamental dimensions within which all experience and existence occur."
]

history_chunks = [
    "The Industrial Revolution transformed society by introducing mechanized production and changing labor practices.",
    "Ancient civilizations developed sophisticated systems of governance, trade, and cultural expression.",
    "Wars throughout history have shaped political boundaries and influenced technological advancement significantly.",
    "The Renaissance period marked a rebirth of art, science, and intellectual inquiry in European culture.",
    "Colonial expansion spread European influence worldwide while profoundly impacting indigenous populations everywhere.",
    "The development of writing systems enabled the preservation and transmission of knowledge across generations.",
    "Religious movements have profoundly influenced social structures, moral values, and political systems throughout time.",
    "Trade routes connected distant civilizations, facilitating cultural exchange and economic development across continents.",
    "Revolutionary movements emerged when social tensions reached critical points in various historical periods.",
    "Technological innovations like the printing press dramatically changed how information was shared and preserved."
]

# Categories for file generation
categories = {
    "fiction": fiction_chunks,
    "science": science_chunks,
    "philosophy": philosophy_chunks,
    "history": history_chunks
}

def generate_content(category, chunk_list, file_num):
    """Generate content for a file"""
    # Pick 3-5 random chunks from the category
    num_chunks = random.randint(3, 5)
    selected_chunks = random.sample(chunk_list, min(num_chunks, len(chunk_list)))
    
    title = f"{category.title()} Note {file_num:06d}"
    
    content = f"# {title}\n\n"
    content += f"Category: {category.title()}\n"
    content += f"Generated: File {file_num}\n\n"
    
    for i, chunk in enumerate(selected_chunks, 1):
        content += f"## Section {i}\n\n{chunk}\n\n"
        
        # Sometimes add related thoughts
        if random.random() < 0.3:
            content += f"This relates to concepts in {random.choice(list(categories.keys()))} and demonstrates the interconnectedness of knowledge domains.\n\n"
    
    # Sometimes add cross-references
    if random.random() < 0.2:
        other_file = random.randint(1, file_num - 1) if file_num > 1 else 1
        content += f"See also: [[Note {other_file:06d}]] for related concepts.\n\n"
    
    return content

def create_large_corpus(target_files=10000):
    """Create a large corpus of test files"""
    print(f"Creating corpus with {target_files} files...")
    
    # Get current file count
    existing_files = list(test_vault_dir.glob("*.md"))
    start_num = len(existing_files) + 1
    
    print(f"Found {len(existing_files)} existing files, starting from {start_num}")
    
    for i in range(start_num, start_num + target_files):
        # Pick a random category
        category = random.choice(list(categories.keys()))
        chunks = categories[category]
        
        # Generate content
        content = generate_content(category, chunks, i)
        
        # Create filename
        filename = f"generated_note_{i:06d}_{category}.md"
        filepath = test_vault_dir / filename
        
        # Write file
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        if i % 5000 == 0:
            print(f"Created {i - start_num + 1:,}/{target_files:,} files...")
    
    print(f"Corpus creation complete! Total files: {len(list(test_vault_dir.glob('*.md')))}")

def main():
    print(f"Test vault directory: {test_vault_dir.absolute()}")
    
    # Check how many files we currently have
    current_files = list(test_vault_dir.glob("*.md"))
    print(f"Current file count: {len(current_files)}")
    
    # Create files to get to ~20,000 total
    target_total = 20000
    target_new_files = max(0, target_total - len(current_files))
    
    if target_new_files > 0:
        print(f"Creating {target_new_files} additional files to reach ~{target_total:,} total")
        create_large_corpus(target_new_files)
    else:
        print("Already have enough files!")
    
    # Final count
    final_files = list(test_vault_dir.glob("*.md"))
    print(f"Final file count: {len(final_files)}")

if __name__ == "__main__":
    main()