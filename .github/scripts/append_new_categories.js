// Configuration variables
const indexJsonPath = 'ai-character-chat/characters/index.json';
const categoriesJsonPath = 'categories.json';
const defaultCategoryStructure = {
    "description": "Auto-generated category",
    "tags": {
        "general": [],
        "nsfw": []
    },
    "required": false,
    "nsfw_only": false
};

// Import required modules
const fs = require('fs').promises;
const path = require('path');

/**
 * Main function to update categories.json with new categories and tags from index.json
 */
async function updateCategories() {
    try {
        // Read the input files
        console.log(`Reading ${indexJsonPath}...`);
        const indexData = JSON.parse(await fs.readFile(indexJsonPath, 'utf8'));
        
        console.log(`Reading ${categoriesJsonPath}...`);
        const categoriesData = JSON.parse(await fs.readFile(categoriesJsonPath, 'utf8'));
        
        // Create a map of existing categories for easier lookup
        const existingCategories = {};
        categoriesData.forEach(category => {
            existingCategories[category.name.toLowerCase()] = category;
        });
        
        // Extract all unique categories and tags from index.json
        const newCategoriesAndTags = extractCategoriesAndTags(indexData);
        
        // Update existing categories with new tags and create new categories as needed
        let updated = false;
        
        for (const [categoryName, tags] of Object.entries(newCategoriesAndTags)) {
            // Normalize the category name (first letter uppercase, rest lowercase)
            const normalizedName = categoryName.charAt(0).toUpperCase() + categoryName.slice(1).toLowerCase();
            
            if (existingCategories[normalizedName.toLowerCase()]) {
                // Category exists, update its tags
                const category = existingCategories[normalizedName.toLowerCase()];
                
                // Add new tags to general tags
                tags.forEach(tag => {
                    // Check if tag already exists in general tags
                    const generalTagExists = category.tags.general.some(
                        existingTag => existingTag.toLowerCase() === tag.toLowerCase()
                    );
                    
                    // Check if tag already exists in nsfw tags
                    const nsfwTagExists = category.tags.nsfw && category.tags.nsfw.some(
                        existingTag => existingTag.toLowerCase() === tag.toLowerCase()
                    );
                    
                    // Add tag if it doesn't exist in either list
                    if (!generalTagExists && !nsfwTagExists) {
                        category.tags.general.push(tag);
                        updated = true;
                        console.log(`Added new tag "${tag}" to category "${normalizedName}"`);
                    }
                });
            } else {
                // Create a new category with the discovered tags
                const newCategory = {
                    ...defaultCategoryStructure,
                    name: normalizedName,
                    tags: {
                        general: [...tags],
                        nsfw: []
                    }
                };
                
                categoriesData.push(newCategory);
                existingCategories[normalizedName.toLowerCase()] = newCategory;
                updated = true;
                console.log(`Created new category "${normalizedName}" with tags: ${tags.join(', ')}`);
            }
        }
        
        // Save the updated categories if changes were made
        if (updated) {
            await fs.writeFile(
                categoriesJsonPath, 
                JSON.stringify(categoriesData, null, 4), 
                'utf8'
            );
            console.log(`Updated categories saved to ${categoriesJsonPath}`);
        } else {
            console.log('No new categories or tags found. No changes made.');
        }
        
    } catch (error) {
        console.error('Error updating categories:', error);
        process.exit(1);
    }
}

/**
 * Extract all unique categories and their tags from the index.json data
 * @param {Array} indexData - The parsed content of index.json
 * @returns {Object} - An object with category names as keys and arrays of tags as values
 */
function extractCategoriesAndTags(indexData) {
    const categoriesAndTags = {};
    
    // Iterate through each character in the index
    indexData.forEach(character => {
        const categories = character.manifest.categories;
        
        if (!categories) {
            return; // Skip if no categories defined
        }
        
        // Process each category and its tags
        Object.entries(categories).forEach(([categoryName, value]) => {
            // Initialize the category if we haven't seen it yet
            if (!categoriesAndTags[categoryName]) {
                categoriesAndTags[categoryName] = [];
            }
            
            // If the value is an array, add each tag
            if (Array.isArray(value)) {
                value.forEach(tag => {
                    if (!categoriesAndTags[categoryName].includes(tag)) {
                        categoriesAndTags[categoryName].push(tag);
                    }
                });
            } 
            // If the value is a string (like "sfw" for rating), add it as a tag
            else if (typeof value === 'string') {
                const tag = value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
                if (!categoriesAndTags[categoryName].includes(tag)) {
                    categoriesAndTags[categoryName].push(tag);
                }
            }
        });
    });
    
    return categoriesAndTags;
}

// Execute the main function
updateCategories().then(() => {
    console.log('Categories update process completed.');
});