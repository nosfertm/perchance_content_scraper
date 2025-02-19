/* -------------------------------------------------------------------------- */
/*                                CONFIGURATION                               */
/* -------------------------------------------------------------------------- */

// Define version to show on console.log
const scriptVersion = '1.0';

// Configuration variables
const CONFIG = {
    // Paths
    BASE_PATH: "ai-character-chat/characters",
    SOURCE_PATH: "ai-character-chat/characters/scrape/perchance_comments",
    PATHS: {
        VALIDATED_SFW: "sfw",
        VALIDATED_NSFW: "nsfw",
        MANUAL_REVIEW: "Manual Review",
        QUARANTINE: "Quarantine",
        DISCARDED_INVALID: "Discarded/Invalid",
        DISCARDED_DUPLICATE: "Discarded/Duplicated",
        ERROR: "Error"
    },

    // Processing limits
    MAX_CHARACTERS_PER_RUN: 100,  // Maximum number of characters to process in one run

    // File patterns
    METADATA_FILE: "metadata.json",
    MESSAGE_FILE: "capturedMessage.json"
}

// API Configuration and quotas
const API_CONFIG = {
    gemini: {
        token: process.env.GEMINI_TOKEN,
        model: 'gemini-2.0-flash',
        rateLimit: 60,  // Calls per minute
        maxCalls: 1000, // Maximum calls per day
        maxRetries: 3,  // Maximum retry attempts
        timeBetweenRetries: 3000, // Time in ms between retries
        endExecutionOnFail: true  // Whether to stop execution if API fails
    },
    pigimage: {
        token: process.env.PIGIMAGE_TOKEN,
        url: 'https://api.imagepig.com/',
        rateLimit: 2,
        maxCalls: 1,
        maxRetries: 3,
        timeBetweenRetries: 3000,
        endExecutionOnFail: false
    },
    freeimage: {
        token: process.env.FREEIMAGE_TOKEN,
        url: 'https://freeimage.host/api/1/upload',
        rateLimit: -1,
        maxCalls: -1,
        maxRetries: 3,
        timeBetweenRetries: 3000,
        endExecutionOnFail: false
    }
};

// File operations configuration
const FILE_OPS = {
    QUOTA_FILE: 'api_quotas.json',
    CATEGORIES_FILE: 'categories.json',
    ENCODING: 'utf8'
};

// Statistics tracking
let stats = {
    processed: 0,
    sfw: 0,
    nsfw: 0,
    manualReview: 0,
    quarantine: 0,
    invalid: 0,
    duplicate: 0,
    errors: []
};

/* ------------------------------ DEPENDENCIES ------------------------------ */

// Import modules in CommonJS format
const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const { gunzip } = require('zlib');
const util = require('util');
const zlib = require('zlib');

const { GoogleGenerativeAI } = require("@google/generative-ai");
//const { json } = require('stream/consumers');

// Promisify 'gunzip'
const gunzipAsync = promisify(gunzip);
const gzip = util.promisify(zlib.gzip);

// API Config
const genAI = new GoogleGenerativeAI(API_CONFIG.gemini.token);
const model = genAI.getGenerativeModel({ model: API_CONFIG.gemini.model });

/* -------------------------------------------------------------------------- */
/*                                   CLASSES                                  */
/* -------------------------------------------------------------------------- */

/* ------------------------------- FileHandler ------------------------------ */
/**
 * Centralized file operations handler
 * Manages all file system operations in one place
 */
class FileHandler {
    /**
     * Read a file's contents
     * @param {string} filePath - Path to the file
     * @param {string} encoding - File encoding (default: utf8)
     * @returns {Promise<string|Buffer>} - File contents
     */
    static async readFile(filePath, encoding = FILE_OPS.ENCODING) {
        try {
            return await fs.readFile(filePath, encoding);
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`⚠️ File not found for reading: ${filePath}.`);
                return {};
            } else {
                console.error(`Error reading file ${filePath}:`, error);
                throw error;
            }
        }
    }

    /**
     * Write content to a file
     * @param {string} filePath - Path to the file
     * @param {string|Buffer} content - Content to write
     * @param {string} encoding - File encoding (default: utf8)
     */
    static async writeFile(filePath, content, encoding = FILE_OPS.ENCODING) {
        try {
            const dir = path.dirname(filePath);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(filePath, content, encoding);
        } catch (error) {
            console.error(`Error writing file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Read and parse a JSON file
     * @param {string} filePath - Path to the JSON file
     * @returns {Promise<object>} - Parsed JSON content
     */
    static async readJson(filePath) {
        try {
            const content = await this.readFile(filePath);
            return JSON.parse(content);
        } catch (error) {
            console.error(`Error in readJson for file ${filePath}:`, error);

            if (error.code === 'ENOENT') {
                console.warn(`⚠️ File not found: ${filePath}. Returning empty object.`);
                return {};
            } else {
                throw error;
            }
        }
    }


    /**
     * Write an object as JSON to a file
     * @param {string} filePath - Path to the JSON file
     * @param {object} data - Object to write as JSON
     */
    static async writeJson(filePath, data) {
        try {
            await this.writeFile(filePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error(`Error writing JSON file ${filePath}:`, error);
            throw error;
        }
    }

    /**
     * Delete a directory and its contents
     * @param {string} dirPath - Path to the directory
     */
    static async removeDirectory(dirPath) {
        try {
            await fs.rm(dirPath, { recursive: true });
        } catch (error) {
            console.error(`Error removing directory ${dirPath}:`, error);
            throw error;
        }
    }
}

/* ------------------------------ Quota Manager ----------------------------- */

/**
 * API Quota Manager
 * Tracks and manages API usage quotas
 */
class QuotaManager {
    constructor() {
        this.quotaFile = FILE_OPS.QUOTA_FILE;
        this.quotas = {};
    }

    /**
     * Initialize quotas from file or create new
     */
    async init() {
        try {
            this.quotas = await FileHandler.readJson(this.quotaFile);
        } catch (err) {
            console.error(`Error loading quotas:`, err);

            // Initial quota structure with lastCall tracking
            this.quotas = Object.keys(API_CONFIG).reduce((acc, api) => {
                acc[api] = {
                    dailyCalls: 0,
                    lastReset: new Date().toISOString(),
                    lastCall: new Date().toISOString()  // Add tracking of last API call
                };
                return acc;
            }, {});
            await this.saveQuotas();
        }
    }

    /**
     * Save current quotas to file
     */
    async saveQuotas() {
        await FileHandler.writeJson(this.quotaFile, this.quotas);
    }

    /**
     * Check if API has remaining quota
     * @param {string} apiName - Name of the API
     * @returns {boolean} - Whether API has remaining quota
     */
    async checkQuota(apiName) {
        const today = new Date().toISOString().split('T')[0];
        const lastReset = this.quotas[apiName].lastReset.split('T')[0];

        if (today !== lastReset) {
            this.quotas[apiName] = { dailyCalls: 0, lastReset: new Date().toISOString() };
            await this.saveQuotas();
        }

        // Executes cooldown if needed
        await this.Cooldown();

        return API_CONFIG[apiName].maxCalls === -1 || this.quotas[apiName].dailyCalls < API_CONFIG[apiName].maxCalls;
    }

    /**
     * Increment API call count
     * @param {string} apiName - Name of the API
     */
    async incrementQuota(apiName) {
        this.quotas[apiName].dailyCalls++;
        this.quotas[apiName].lastCall = new Date().toISOString();
        await this.saveQuotas();
    }

    /**
     * Calculate required cooldown time for an API based on its rate limit and last call
     * @param {string} apiName - Name of the API to check
     * @returns {number} - Required cooldown time in milliseconds, 0 if no cooldown needed
     */
    calculateRequiredCooldown(apiName) {
        // Get API configuration and last call time
        const apiConfig = API_CONFIG[apiName];
        const lastCallTime = new Date(this.quotas[apiName].lastCall);
        const now = new Date();

        // If API has no rate limit (-1), return 0
        if (apiConfig.rateLimit === -1) return 0;

        // Calculate minimum time between calls in milliseconds
        const minTimeBetweenCalls = (1000 * 60) / apiConfig.rateLimit;

        // Calculate time elapsed since last call
        const timeElapsed = now - lastCallTime;

        // If enough time has passed, no cooldown needed
        if (timeElapsed >= minTimeBetweenCalls) return 0;

        // Return remaining cooldown time needed
        return minTimeBetweenCalls - timeElapsed;
    }

    /**
     * Calculate and execute the maximum required cooldown across critical APIs
     * Critical APIs are those with endExecutionOnFail set to true
     * @returns {Promise<void>}
     */
    async Cooldown() {
        let maxCooldown = 0;
        let apiRequiringMaxCooldown = null;

        // Iterate through all APIs to find maximum required cooldown
        for (const [apiName, config] of Object.entries(API_CONFIG)) {
            // Only check APIs where execution must stop on failure
            if (config.endExecutionOnFail) {
                const cooldownNeeded = this.calculateRequiredCooldown(apiName);

                if (cooldownNeeded > maxCooldown) {
                    maxCooldown = cooldownNeeded;
                    apiRequiringMaxCooldown = apiName;
                }
            }
        }

        // If a cooldown is needed, execute it and update the last call time
        if (maxCooldown > 0 && apiRequiringMaxCooldown) {
            console.log(`Executing cooldown of ${maxCooldown}ms for critical API ${apiRequiringMaxCooldown}`);
            await new Promise(resolve => setTimeout(resolve, maxCooldown));
        }
    }

}

/* -------------------------------------------------------------------------- */
/*                                  API CALLS                                 */
/* -------------------------------------------------------------------------- */

async function uploadImage(img, api = 'freeimage') {

    // Handle base64
    const imgData = img.includes('base64,')
        ? img.split('base64,')[1]
        : img;

    const form = new FormData();
    form.append('key', API_CONFIG[api].token);
    form.append('action', 'upload');
    form.append('source', imgData);
    form.append('format', 'json');

    try {
        if (!(await quotaManager.checkQuota(api))) {
            console.log('FreeImage API quota exceeded. Skipping image upload.');
            return null;
        }

        //console.log('Sending request with data length:', imgData.length);

        const response = await fetch(API_CONFIG[api].url, {
            method: 'POST',
            body: form
        });

        const data = await response.json();

        if (data.status_code === 200) {
            console.log('    Successfully uploaded image to Freeimage.\nURL:', data.image.url);
            await quotaManager.incrementQuota(api);
            return data.image.url;
        } else {
            console.error('Failed to send image:', data.status_txt);
            return null;
        }
    } catch (error) {
        console.error('Error on sending image:', error.message);
        return null;
    }
}

async function generateImage(aiAnalysis, api = 'pigimage') {

    const prompt = aiAnalysis.description;

    // Return if prompt is blank
    if (!prompt || prompt.trim() === '') return null;

    if (!(await quotaManager.checkQuota(api))) { // Check for quota
        console.log('PigImage API quota exceeded. Skipping image generation.');
        return null;
    }

    try {
        const response = await fetch(API_CONFIG[api].url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Api-Key': API_CONFIG[api].token
            },
            body: JSON.stringify({ "prompt": prompt })
        });

        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        } else {
            await quotaManager.incrementQuota(api);
        }

        const json = await response.json();
        const imageData = json.image_data; // Base64 image data directly from the API response

        // Assuming the image is JPEG, modify MIME type if needed
        const mimeType = 'image/jpeg'; // Modify this depending on the image format
        const base64ImageWithMime = `data:${mimeType};base64,${imageData}`;

        return base64ImageWithMime; // Return the base64-encoded image with MIME type
    } catch (error) {
        console.error(error);
        throw error; // Rethrow or handle as necessary
    }
}

/**
 * Placeholder function for AI analysis
 * @param {object} characterData - Character data from gz file
 */
async function analyzeCharacterWithAI() {
    return {
        "rating": "sfw",
        "description": "Kirby is a small, pink, spherical creature with a cheerful disposition. He's brave, kind, and resourceful, often using his ability to inhale and copy powers to save Dream Land.",
        "needsManualReview": false,
        "charState": "valid",
        "stateReason": "",
        "categories": {
            "Rating": [
                "SFW"
            ],
            "Species": [
                "Slime"
            ],
            "Gender": [
                "Non-binary"
            ],
            "Age Group": [
                "Child"
            ],
            "Genre": [
                "Adventure",
                "Action",
                "Fantasy"
            ],
            "Source": [
                "Game"
            ],
            "Role": [
                "Hero"
            ],
            "Personality": [
                "Cheerful",
                "Brave",
                "Friendly"
            ],
            "Physical Traits": [
                "Short"
            ],
            "Setting": [
                "Fantasy World"
            ]
        },
        "invalidTags": [
            {
                "Personality": [
                    "Kind"
                ]
            },
            {
                "Personality": [
                    "Resourceful"
                ]
            },
            {
                "Physical Traits": [
                    "Pink"
                ]
            }
        ]
    };
}

/**
 * Classifies a character based on provided description, reminder, and categories
 * @param {string} roleInstruction - Main character description
 * @param {string} reminder - Additional character details/reminders
 * @param {Array} categories - Array of category objects with name, description, and tags
 * @returns {Promise<string>} - Stringified JSON with character classification
 */
async function classifyCharacter(roleInstruction = '', reminder = '', userRole = '', categories, api = 'gemini') {

    // Check Gemini API quota
    if (!(await quotaManager.checkQuota('gemini'))) {
        console.log('Gemini API quota exceeded. Halting execution.');
        process.exit(0);
    }

    // Input validation
    if (!Array.isArray(categories)) {
        console.error(`Error calling classifyCharacter: Categories must be an array.\nCategories: ${JSON.stringify(categories)}`)
        return null;
    }

    // Convert categories array to a more usable format for the prompt
    const categoriesMap = categories.reduce((acc, category) => {
        acc[category.name] = {
            description: category.description,
            tags: {
                ...category.tags.general && { general: category.tags.general },
                ...category.tags.nsfw && { nsfw: category.tags.nsfw }
            },
            required: category.required,
            nsfw_only: category.nsfw_only
        };
        return acc;
    }, {});

    // Construct the prompt with updated instructions
    const prompt = `
    Analyze the following character description and perform a comprehensive validation.
    Determine whether it is SFW (Safe for Work) or NSFW (Not Safe for Work) and validate the character state.
    Create a brief description of the character with their appearance and categorize them according to the available categories.

    Important rules:
    - You can use multiple tags from each category
    - For NSFW characters, create a description that appropriately reflects their NSFW nature
    - Some categories are marked as required (required: true)
    - Some categories are only for NSFW content (nsfw_only: true)
    - Use tags from either 'general' or 'nsfw' lists as appropriate

    Character State Rules:
    - 'valid': (Default Value) Character has complete, appropriate and coherent data
    - 'invalid': Character is broken, trolling content, or otherwise unusable
    - 'quarantine': Character contains ILLEGAL content (distinct from immoral content)

    Needs manual review Rules:
    - true: Character has EXTREME NSFW content, or the data isn't enough to fill the other fields
    - false: Default value

    Guidelines for determining character state:
    1. Verify the content is not trolling or nonsensical
    2. Ensure no illegal content is present
    3. Confirm the character data is complete and coherent

    Return only a JSON formatted response with the following structure:
    {
        "rating": "sfw" | "nsfw",  // For this key, ignore the available categories format and answer strictly with either 'sfw' or 'nsfw'.
        "description": "<brief description>",
        "needsManualReview": boolean,
        "charState": "valid" | "invalid" | "quarantine",  // States for validation of the content
        "stateReason": "<reason for state if not valid>",  // Explanation for the invalid or quarantined state
        "categories": {
            "<category_name>": ["<matching tags>"]  // // Each category or tag name must be in lowercase
        }
}



    Do not include markdown, further explanation or anything else. 
    ATTENTION: Return only pure stringified JSON!

    Here is the character description:
    ${roleInstruction}

    Here is the character reminder:
    ${reminder}

    Here is the role user plays with this character:
    ${userRole}

    Available categories:
    ${JSON.stringify(categoriesMap, null, 2)}
    `;

    let responseText;

    try {
        // Generate content using the AI model
        const result = await model.generateContent(prompt);

        // Ensure response exists
        if (!result || !result.response) {
            throw new Error('No response from Gemini API');
        }

        // Get the response text and clean it
        responseText = result.response.text().trim();
        //console.log('Raw result:', result.response.text().trim());

        // Handle empty response
        if (!responseText) {
            throw new Error('Empty response from Gemini API');
        }

        // Remove any markdown code block markers
        responseText = responseText.replace(/^```json\n?|```$/g, '').trim();

        // Parse the JSON response
        const parsedJson = JSON.parse(responseText);

        // Validate basic response structure
        if (!parsedJson.description || !parsedJson.categories) {
            throw new Error('Missing required fields in response');
        }

        // // Validate categories against the provided categories array
        // const validCategoryNames = new Map(
        //     categories.map(c => [c.name.toLowerCase(), c.name])
        // );
        // const invalidCategories = [];
        // const invalidTags = [];
        // const validatedCategories = {};

        // for (const categoryName in parsedJson.categories) {
        //     const categoryNameLower = categoryName.toLowerCase();

        //     // Se a categoria não é válida, armazena e pula
        //     if (!validCategoryNames.has(categoryNameLower)) {
        //         invalidCategories.push({
        //             [categoryName]: parsedJson.categories[categoryName]
        //         });
        //         continue;
        //     }

        //     // Use o nome original da categoria do mapeamento
        //     const originalCategoryName = validCategoryNames.get(categoryNameLower);

        //     // Find the category definition
        //     const categoryDef = categories.find(c => c.name.toLowerCase() === categoryNameLower);
        //     const providedTags = Array.isArray(parsedJson.categories[categoryName])
        //         ? parsedJson.categories[categoryName]
        //         : [parsedJson.categories[categoryName]];

        //     // Validate that all provided tags exist in either general or nsfw tags
        //     const validTags = new Set([
        //         ...(categoryDef.tags.general || []),
        //         ...(categoryDef.tags.nsfw || [])
        //     ]);

        //     const validTagsForCategory = providedTags.filter(tag => {
        //         if (!validTags.has(tag)) {
        //             invalidTags.push({ [originalCategoryName]: [tag] });
        //             return false;
        //         }
        //         return true;
        //     });

        //     // Só adiciona a categoria se houver tags válidas
        //     if (validTagsForCategory.length > 0) {
        //         validatedCategories[originalCategoryName] = validTagsForCategory;
        //     }
        // }

        // // Substitui as categorias originais pelas validadas
        // parsedJson.categories = validatedCategories;

        // // Check if all required categories are present
        // const requiredCategories = categories
        //     .filter(c => c.required)
        //     .map(c => c.name);

        // for (const requiredCategory of requiredCategories) {
        //     if (!parsedJson.categories[requiredCategory]) {
        //         throw new Error(`Missing required category: ${requiredCategory}`);
        //     }
        // }

        await quotaManager.incrementQuota(api);

        // Retorna o resultado com as listas de inválidos
        // return JSON.stringify({
        //     ...parsedJson,
        //     ...(invalidCategories.length > 0 && { invalidCategories }),
        //     ...(invalidTags.length > 0 && { invalidTags })
        // }, null, 2);

        // Fix rating array issues
        return fixRating(parsedJson);

    } catch (error) {

        // Handle API-specific errors
        if (error.message.includes('API key not valid')) {
            console.error('\nGemini - Invalid API key. Check your configuration.');
        } else if (error.message.includes('400 Bad Request')) {
            console.error('\nGemini - Bad request. Verify input data and prompt format.');
        } else {
            console.error('\nGemini - Error processing response:', error);
        }

        return null;
    }
}

// Function to process rating and transform it into 'sfw' or 'nsfw'
function processRating(rating) {
    // If it's an array, check if it contains "SFW" (case insensitive), otherwise set to "NSFW"
    if (Array.isArray(rating)) {
        return rating.some(tag => tag.toLowerCase() === "sfw") ? "sfw" : "nsfw";
    }
    // If it's not an array, just return the same logic applied to the string value
    return rating.toLowerCase() === "sfw" ? "sfw" : "nsfw";
}

function fixRating(parsedJson) {
    // Process the rating outside of categories
    if (parsedJson.rating) {
        parsedJson.rating = processRating(parsedJson.rating);
    }

    // Process the rating inside categories, if it exists
    if (parsedJson.categories && parsedJson.categories.Rating) {
        parsedJson.categories.Rating = processRating(parsedJson.categories.Rating);
    }

    return parsedJson;
}

/* -------------------------------------------------------------------------- */
/*                                PATH HANDLING                               */
/* -------------------------------------------------------------------------- */

/**
 * Get list of character folders to process
 */
async function getCharacterFolders() {
    try {
        // Read directory contents
        const folders = await fs.readdir(CONFIG.SOURCE_PATH);

        // Filter out hidden files (starting with '.')
        const filter = folders.filter(folder => !folder.startsWith('.'));

        // Log found files/folders for debugging
        //console.log("Found files/folders:", filter);

        return filter;

    } catch (err) {
        console.error(`Error reading directory ${CONFIG.SOURCE_PATH}:`, err.message);
        throw err;
    }
}

/**
 * Check if character already exists in output directory
 * @param {string} folder - Character folder name
 * @returns {Promise<boolean>} - Whether character exists
 */
async function checkDuplicateCharacter(folder) {
    try {
        // Get all paths from CONFIG.PATHS dynamically
        const possiblePaths = Object.values(CONFIG.PATHS);

        for (const checkPath of possiblePaths) {
            const fullPath = path.join(CONFIG.BASE_PATH, checkPath, folder);
            try {
                await fs.access(fullPath);
                console.log(`Checking for duplicates on ${fullPath}`);
                return true;
            } catch {
                // Path doesn't exist, continue checking
            }
        }
        return false;
    } catch (error) {
        console.error(`Error checking for duplicate character ${folder}:`, error);
        throw error;
    }
}

/**
 * Handle duplicate character
 * @param {string} folder - Character folder name
 * @param {string} existingPath - Path to existing character
 */
async function handleDuplicate(folder, existingPath) {
    try {
        const duplicatePath = path.join(CONFIG.BASE_PATH, CONFIG.PATHS.DISCARDED_DUPLICATE, folder);
        const referenceContent = {
            originalPath: existingPath,
            duplicateDate: new Date().toISOString()
        };

        await FileHandler.writeJson(path.join(duplicatePath, 'duplicate_reference.json'), referenceContent);
        stats.duplicate++;
    } catch (error) {
        console.error(`Error handling duplicate character ${folder}:`, error);
        throw error;
    }
}

/**
 * Determine destination path based on AI analysis
 * @param {object} aiAnalysis - Analysis results from AI
 */
function determineDestinationPath(aiAnalysis, folder) {

    // Ensure the keys are valid
    const charState = aiAnalysis.charState ? aiAnalysis.charState.toLowerCase() : null;
    const manualReview = aiAnalysis.needsManualReview ? aiAnalysis.needsManualReview : null;
    const rating = Array.isArray(aiAnalysis.rating)
        ? aiAnalysis.rating.find(item => ['sfw', 'nsfw'].includes(item.toLowerCase()))?.toLowerCase()
        : (typeof aiAnalysis.rating === 'string' ? aiAnalysis.rating.toLowerCase() : null);


    // Send to manual review
    if (manualReview) {
        filePath = CONFIG.PATHS.MANUAL_REVIEW;
        FileHandler.writeJson(path.join(CONFIG.BASE_PATH, filePath, folder, 'aiAnalysis.json'), aiAnalysis)
        return filePath;
    }

    // Check the state
    if (charState === 'valid') {
        // If valid, send to the appropriate folder
        return rating === 'sfw'
            ? CONFIG.PATHS.VALIDATED_SFW
            : CONFIG.PATHS.VALIDATED_NSFW;
    } else {
        // If not valid, send to invalid or quarantine
        if (charState === 'quarantine') {
            return CONFIG.PATHS.QUARANTINE;
        } else if (aiAnalysis.charState.toLowerCase() === 'invalid') {
            return CONFIG.PATHS.DISCARDED_INVALID;
        } else {
            return CONFIG.PATHS.DISCARDED_ERROR;
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                          CHARACTER FILES HANDLING                          */
/* -------------------------------------------------------------------------- */

/**
 * Extract character data from gz file
 * @param {string} folder - Character folder name
 * @param {string} fileName - File name
 */
async function extractCharacterData(folder, fileName, retry = false) {
    const gzPath = path.join(CONFIG.SOURCE_PATH, folder, fileName);
    let gzBuffer;

    try {
        // Attempt to read the gzipped file
        gzBuffer = await fs.readFile(gzPath);
    } catch (error) {
        // If the file is not found, trigger download
        if (error.code === 'ENOENT') {
            console.error(`File ${fileName} not found. Downloading...`);
            await downloadFile(folder, fileName);  // Implement the actual download function
            gzBuffer = await fs.readFile(gzPath);  // Try reading again after downloading
        } else {
            // Re-throw other errors (e.g., permission issues)
            throw error;
        }
    }

    let unzipped;
    try {
        // Attempt to decompress the file
        unzipped = await gunzipAsync(gzBuffer);
    } catch (error) {
        // Handle specific error for incorrect gzip header
        if (error.code === 'Z_DATA_ERROR' && error.message.includes('incorrect header check')) {
            console.error(`    Error extracting data from ${fileName}: ${error.message}`);
            console.log('    The file may be corrupted, attempting to download and retry.');

            // If retry flag is set, prevent infinite recursion
            if (retry) {
                console.error('Download failed. Retrying extraction without download.');
                return null;  // Return null to indicate failure
            }

            // Download the file and attempt extraction again
            await downloadFile(folder, fileName);
            return extractCharacterData(folder, fileName, true);  // Retry after downloading
        } else {
            // Re-throw any other unexpected errors
            throw error;
        }
    }

    // Return the uncompressed data as a JSON object
    return JSON.parse(unzipped.toString());
}

/**
 * Downloads file from URL and returns it as a Buffer
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} File content as Buffer
 */
async function downloadFile(dir, filename) {
    try {
        const download_url = `https://user-uploads.perchance.org/file/${filename}`;
        console.log(`        Downloading: ${download_url}`);

        const response = await fetch(download_url);
        if (!response.ok) {
            throw new Error(`       Download failed: ${response.status}`);
        }

        // Convert response to buffer
        const fileData = Buffer.from(await response.arrayBuffer());

        // Define full file path
        const filePath = path.join(CONFIG.SOURCE_PATH, dir, filename);

        // Call the writeFile function
        await fs.writeFile(filePath, fileData, null); // No encoding for binary files

        console.log(`        Download successfully saved on: ${filePath}`);
        return filePath;
    } catch (error) {
        console.error('     Failed to download file:', error.message);
        throw error;
    }
}

/**
 * Create character structure in destination
 * @param {string} folder - Original folder name
 * @param {object} metadata - Metadata from source
 * @param {object} characterData - Character data from gz file
 * @param {object} aiAnalysis - AI analysis results
 * @param {string} destinationPath - Destination path
 */
async function createCharacterStructure(folder, metadata, message, characterData, aiAnalysis, destinationPath, img) {

    // Create character files
    const importFileName = `character_${folder}.gz`
    const characterInfo = characterData.addCharacter || {};
    const charFiles = await createCharacterFiles(characterInfo, importFileName, img)

    // Create manifest
    const manifest = createManifest(metadata, message, characterData, aiAnalysis, charFiles, destinationPath, folder, importFileName);

    // Create changelog
    const changelog = createChangelog(message);

    // Prepare files to commit
    const filename = metadata.fileId;
    const files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'changelog.json': JSON.stringify(changelog, null, 2),
        [filename]: await util.promisify(gzip)(JSON.stringify(characterData))
    };

    // Add character files to the list of files
    Object.entries(charFiles).forEach(([filePath, content]) => {
        files[filePath] = content;
    });

    // Write files to destination // TODO - fix all fs. uses fs.mkdir/fs.writeFile
    const destFolder = path.join(CONFIG.BASE_PATH, destinationPath, folder);
    await fs.mkdir(destFolder, { recursive: true });

    for (const [filename, content] of Object.entries(files)) {
        const filePath = path.join(destFolder, filename);

        // Create root directory before writing files
        const dirPath = path.dirname(filePath);  // Get file path
        await fs.mkdir(dirPath, { recursive: true });  // Create directories

        // Write file on correct path
        await fs.writeFile(filePath, content);
    }


    // Update index.json
    await updateCharacterIndex(destFolder, manifest);
}

/**
 * Create individual files for each character attribute and zip file
 * @param {Object} characterInfo - Dictionary containing character information
 * @param {string} dirName - Directory name for the character files
 * @param {string} fileName - A name for files, in a pattern 'Character by Author'
 * @returns {Promise<Object>} Dictionary of created files and their content
 */
async function createCharacterFiles(characterInfo, importFileName, img) {
    console.log("\n    Creating character files:")

    // Replace avatar.url with img if avatar exists
    if (characterInfo.avatar && typeof characterInfo.avatar === 'object' && img) {
        characterInfo.avatar.url = img;
    }

    const files = {};

    // Define fields and their corresponding file formats
    const fieldFormats = {
        name: 'txt',
        roleInstruction: 'txt',
        reminderMessage: 'txt',
        customCode: 'js',
        imagePromptPrefix: 'txt',
        imagePromptSuffix: 'txt',
        imagePromptTriggers: 'txt',
        initialMessages: 'json',
        loreBookUrls: 'json',
        avatar: 'json',
        scene: 'json',
        userCharacter: 'json',
        systemCharacter: 'json'
    };

    // Create individual files based on format
    // TODO: Replace avatar content with img variable
    for (const [field, formatType] of Object.entries(fieldFormats)) {
        if (characterInfo[field]) {
            let content = characterInfo[field];

            // Replace url inside avatar.json for img
            // if (field === 'avatar') {
            //     content = { url: img };
            // }

            if (formatType === 'json' || typeof content === 'object') {
                content = JSON.stringify(content, null, 2);
            }
            //const sanitizedField = sanitizeFileName(field);
            const filePath = path.normalize(path.join('src', `${field}.${formatType}`));
            files[filePath] = content;
            console.log(`           Created ${filePath}`);
        }
    }

    // Create character.gz containing the original data
    const exportData = {
        formatName: "dexie",
        formatVersion: 1,
        data: {
            databaseName: "chatbot-ui-v1",
            databaseVersion: 90,
            tables: [
                {
                    name: "characters",
                    schema: "++id,modelName,fitMessagesInContextMethod,uuid,creationTime,lastMessageTime",
                    rowCount: 1
                },
                // Empty tables with rowCount 0
                { name: "threads", schema: "++id,name,characterId,creationTime,lastMessageTime,lastViewTime", rowCount: 0 },
                { name: "messages", schema: "++id,threadId,characterId,creationTime,order", rowCount: 0 },
                { name: "misc", schema: "key", rowCount: 0 },
                { name: "summaries", schema: "hash,threadId", rowCount: 0 },
                { name: "memories", schema: "++id,[summaryHash+threadId],[characterId+status],[threadId+status],[threadId+index],threadId", rowCount: 0 },
                { name: "lore", schema: "++id,bookId,bookUrl", rowCount: 0 },
                { name: "textEmbeddingCache", schema: "++id,textHash,&[textHash+modelName]", rowCount: 0 },
                { name: "textCompressionCache", schema: "++id,uncompressedTextHash,&[uncompressedTextHash+modelName+tokenLimit]", rowCount: 0 },
                { name: "usageStats", schema: "[dateHour+threadId+modelName],threadId,characterId,dateHour", rowCount: 0 }
            ],
            data: [
                {
                    tableName: "characters",
                    inbound: true,
                    rows: [{
                        ...characterInfo,
                        id: 1,
                        creationTime: Date.now(),
                        lastMessageTime: Date.now(),
                        $types: {
                            maxParagraphCountPerMessage: "undef",
                            initialMessages: "arrayNonindexKeys",
                            shortcutButtons: "arrayNonindexKeys",
                            loreBookUrls: "arrayNonindexKeys"
                        }
                    }]
                },
                // Empty tables
                { tableName: "threads", inbound: true, rows: [] },
                { tableName: "messages", inbound: true, rows: [] },
                { tableName: "misc", inbound: true, rows: [] },
                { tableName: "summaries", inbound: true, rows: [] },
                { tableName: "memories", inbound: true, rows: [] },
                { tableName: "lore", inbound: true, rows: [] },
                { tableName: "textEmbeddingCache", inbound: true, rows: [] },
                { tableName: "textCompressionCache", inbound: true, rows: [] },
                { tableName: "usageStats", inbound: true, rows: [] }
            ]
        }
    };

    console.log(`           Creating import file: ${importFileName}...`);
    // Compress the export data
    const jsonString = JSON.stringify(exportData, null, 2);
    const compressedData = await gzip(Buffer.from(jsonString, 'utf-8'));
    files[path.join(importFileName)] = compressedData;
    console.log(`           Successfully created ${importFileName}`);

    return files;
}

/**
 * Create manifest for character
 * @param {object} metadata - Character metadata
 * @param {object} characterData - Character data
 * @param {object} aiAnalysis - AI analysis results
 * @param {object} img - Image Link
 */
function createManifest(metadata, message, characterData, aiAnalysis, charFiles, destinationPath, folder, importFileName) {

    console.log("    Creating manifest")

    // Extract avatar
    const avatar = charFiles[path.join('src', 'avatar.json')];
    const imgUrl = JSON.parse(avatar).url

    // Set download path
    const downloadPath = path.join(CONFIG.BASE_PATH, destinationPath, folder, importFileName).replace(/\\/g, '/');

    return {
        name: characterData?.addCharacter?.name || '',
        description: aiAnalysis.description,
        author: message.username || message.userNickname || message.publicId || 'Anonymous',
        authorId: message.userId,
        source: 'SCRAPER',
        imageUrl: imgUrl || '',
        shareUrl: metadata.link,
        downloadPath: downloadPath,
        shapeShifter_Pulls: 0,
        galleryChat_Clicks: 0,
        galleryDownload_Clicks: 0,
        groupSettings: {
            requires: [],
            recommends: []
        },
        features: {
            customCode: charFiles[path.join('src', 'customCode.js')] ?
                [path.join(CONFIG.BASE_PATH, destinationPath, folder, 'src', 'customCode.js')] : [],
            assets: []
        },
        categories: aiAnalysis.categories
    };
}

/**
 * Create changelog for character
 */
function createChangelog(message) {
    console.log("    Creating changelog")

    // Set date variables
    const now = new Date().toISOString();
    const creationDate = new Date(message.time).toISOString(); // Convert timestamp
    return {
        currentVersion: '1.0.0',
        created: now,
        lastUpdated: now,
        history: [
            {
                version: '1.0.0',
                date: creationDate,
                type: 'initial',
                changes: ['Captured via scraper']
            }
        ]
    };
}

/**
 * Update character index file
 * @param {string} characterPath - Path to character folder
 * @param {object} manifest - Character manifest
 */
async function updateCharacterIndex(characterPath, manifest) {
    const indexPath = path.join(CONFIG.BASE_PATH, 'index.json').replace(/\\/g, '/');

    try {
        try {
            await fs.access(indexPath);
        } catch {
            console.log(`Index.json file missing on ${indexPath}.\nCreating a new one.`);
            await fs.writeFile(indexPath, JSON.stringify([]));
        }

        const indexContent = await fs.readFile(indexPath, 'utf8');
        const indexData = JSON.parse(indexContent);

        const relativePath = path.relative(CONFIG.BASE_PATH, characterPath);
        const newEntry = { path: relativePath, manifest };

        const existingIndex = indexData.findIndex(item => item.path === relativePath);
        if (existingIndex !== -1) {
            indexData[existingIndex] = newEntry;
        } else {
            indexData.push(newEntry);
        }

        await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    } catch (error) {
        console.error('Error updating index.json:', error);
        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/*                            CHARACTER PROCESSING                            */
/* -------------------------------------------------------------------------- */

// Update main function to use shuffled array
async function processCharacters() {
    console.log(`Starting character processing ${scriptVersion}...\n`);

    try {

        // Check Gemini API quota
        if (!(await quotaManager.checkQuota('gemini'))) {
            // TODO exit based on config
            console.log('Gemini API quota exceeded. Halting execution.');
            process.exit(0);
        }

        const characterFolders = await getCharacterFolders();
        console.log(`Found ${characterFolders.length} characters to process`);

        // Shuffle folders and limit to MAX_CHARACTERS_PER_RUN
        const shuffledFolders = shuffleArray([...characterFolders]);
        const foldersToProcess = shuffledFolders.slice(0, CONFIG.MAX_CHARACTERS_PER_RUN);
        //console.log(`Processing ${foldersToProcess}`);

        for (const folder of foldersToProcess) {
            // Process the character in the folder
            await processCharacter(folder);

            // Skip cooldown if there's only one folder to process
            if (foldersToProcess.length > 1) {
                await quotaManager.Cooldown();  // Apply cooldown if there are multiple folders
            }
        }


        printStats();

    } catch (error) {
        console.error("Fatal error during processing:", error);
        process.exit(1);
    }
}

async function processCharacter(folder) {
    console.log('\n\n----------------');
    console.log(`Processing character: ${folder}`);

    try {
        // Read metadata.json
        const [metadata] = await FileHandler.readJson(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.METADATA_FILE));

        // Check for duplicate - TODO FIX TO DEAL WITH CHARACTER FOLDER
        const isDuplicate = await checkDuplicateCharacter(folder);
        if (isDuplicate) {
            await handleDuplicate(folder);
            return;
        }

        // Get Gz fileId
        gzFile = metadata.fileId;

        // Extract Gz content or download if corrupted / missing
        const characterData = await extractCharacterData(folder, metadata.fileId);

        // Read capturedMessage.json
        const message = await FileHandler.readJson(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.MESSAGE_FILE));

        // console.log("\n\n")
        // console.log("Character Name:", characterData?.addCharacter?.name || '');
        // console.log("Role Instruction:", characterData?.addCharacter?.roleInstruction || '');
        // console.log("Reminder Message:", characterData?.addCharacter?.reminderMessage || '');
        // console.log("Avatar:", JSON.stringify(characterData?.addCharacter?.avatar || ''));
        // console.log("\n")
        // console.log("User Character Name:", characterData?.userCharacter?.name || '');
        // console.log("User Role Instruction:", characterData?.userCharacter?.roleInstruction || '');
        // console.log("User Avatar:", JSON.stringify(characterData?.userCharacter?.avatar || ''));
        // console.log("\n\n")

        const roleInstruction = characterData?.addCharacter?.roleInstruction || '';
        const reminder = characterData?.addCharacter?.reminderMessage || '';
        const userRole = characterData?.userCharacter?.roleInstruction || '';
        const categories = await FileHandler.readJson(FILE_OPS.CATEGORIES_FILE);

        //const aiAnalysis = await analyzeCharacterWithAI(characterData);
        const aiAnalysis = await classifyCharacter(roleInstruction, reminder, userRole, categories)
        if (!aiAnalysis) {
            errMsg = 'Variable aiAnalysis is blank. Data is needed to continue.\nSkipping character processing.'
            console.error(errMsg)
            stats.errors.push({ folder, error: errMsg || error.message || 'Unknown' });
            return;
        }

        // Variable to check character image condition
        const avatarUrl = characterData?.addCharacter?.avatar?.url || "";
        let finalImage;

        // Check if the avatar URL is empty
        if (!avatarUrl) {
            console.log("    Missing avatar. Trying to generate.");

            // Try to generate a new image
            const generatedImage = await generateImage(aiAnalysis);

            // Upload the generated image
            if (generatedImage) {
                finalImage = await uploadImage(generatedImage);
            } else {
                errMsg = 'Image was not generated. Skipping character.'
                console.error(errMsg)
                stats.errors.push({ folder, error: errMsg || error.message || 'Unknown' });
                return;
            }

        }
        // Check if the avatar URL is a Base64 image
        else if (avatarUrl.startsWith("data:image")) {
            console.log("    Avatar is a Base64 image. Uploading to freeimage.");
            finalImage = await uploadImage(avatarUrl);
        } else {
            finalImage = avatarUrl
        }

        const destinationPath = determineDestinationPath(aiAnalysis, folder);
        await createCharacterStructure(folder, metadata, message, characterData, aiAnalysis, destinationPath, finalImage);

        // Copy capturedMessage.json
        await fs.copyFile(
            path.join(CONFIG.SOURCE_PATH, folder, CONFIG.MESSAGE_FILE),
            path.join(CONFIG.BASE_PATH, destinationPath, folder, CONFIG.MESSAGE_FILE)
        );

        // Copy metadata.json
        await fs.copyFile(
            path.join(CONFIG.SOURCE_PATH, folder, CONFIG.METADATA_FILE),
            path.join(CONFIG.BASE_PATH, destinationPath, folder, CONFIG.METADATA_FILE)
        );
        await FileHandler.removeDirectory(path.join(CONFIG.SOURCE_PATH, folder));
        updateStats(aiAnalysis.rating);

    } catch (error) {
        console.error(`Error processing character in folder ${folder}:`, error);
        stats.errors.push({ folder, error: error.message });
    }
}

/* -------------------------------------------------------------------------- */
/*                             AUXILIARY FUNCTIONS                            */
/* -------------------------------------------------------------------------- */

/**
 * Shuffle array for a random order
 * @param {array} array - Array to be shuffled
 */
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

/**
 * Update processing statistics
 * @param {string} rating - Character rating from AI analysis
 */
function updateStats(rating) {
    stats.processed++;
    switch (rating) {
        case 'sfw': stats.sfw++; break;
        case 'nsfw': stats.nsfw++; break;
        case 'manual_review': stats.manualReview++; break;
        case 'quarantine': stats.quarantine++; break;
        case 'invalid': stats.invalid++; break;
        case 'duplicate': stats.duplicate++; break;
    }
}

/**
 * Print final processing statistics
 */
function printStats() {
    console.log('\n------------------');
    console.log('Processing Summary:');
    console.log('------------------');
    console.log(`Total Processed: ${stats.processed}`);
    console.log(`SFW: ${stats.sfw}`);
    console.log(`NSFW: ${stats.nsfw}`);
    console.log(`Manual Review: ${stats.manualReview}`);
    console.log(`Quarantine: ${stats.quarantine}`);
    console.log(`Invalid: ${stats.invalid}`);
    console.log(`Duplicate: ${stats.duplicate}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
        console.log('\nErrors encountered:');
        stats.errors.forEach(error => {
            console.log(`- ${error.folder}: ${error.error}`);
        });
    }
}

/* -------------------------------------------------------------------------- */
/*                               INITIALIZATION                               */
/* -------------------------------------------------------------------------- */

const quotaManager = new QuotaManager();

async function main() {
    try {
        await quotaManager.init();
        await processCharacters();
    } catch (error) {
        console.error("Fatal error:", error);
        process.exit(1);
    }
}

main();  // Start the application
