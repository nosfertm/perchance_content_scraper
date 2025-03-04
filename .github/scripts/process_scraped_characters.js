/* -------------------------------------------------------------------------- */
/*                                CONFIGURATION                               */
/* -------------------------------------------------------------------------- */

// Define version to show on console.log
const scriptVersion = '2.7';

// Configuration variables
const CONFIG = {
    // Paths
    OUTPUT_PATH: "ai-character-chat/characters",
    SOURCE_PATH: "scrape/perchance_comments/Raw",
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
    MAX_CHARACTERS_PER_RUN: 300,  // Maximum number of characters to process in one run

    // File patterns
    METADATA_FILE: "metadata.json",
    MESSAGE_FILE: "capturedMessage.json"
}

// Similarity analysis configuration
// Similarity analysis configuration
const SIMILARITY_CONFIG = {
    // Core files to check, in order of priority
    // Format: 'filename': { threshold: float, required: boolean, characterDataPath: string }
    // Files are checked in order, subsequent checks only occur if previous meet threshold
    coreSimilarity: {
        'roleInstruction.txt': {
            threshold: 0.80,
            required: true,
            characterDataPath: 'addCharacter.roleInstruction'
        },
        'name.txt': {
            threshold: 0.80,
            required: true,
            characterDataPath: 'addCharacter.name'
        },
        'reminderMessage.txt': {
            threshold: 0.70,
            required: true,
            characterDataPath: 'addCharacter.reminderMessage'
        },
        'initialMessages.json': {
            threshold: 0.70,
            required: false,
            characterDataPath: 'userCharacter.initialMessages'
        },
        'custom-code.js': {
            threshold: 0.60,
            required: false,
            characterDataPath: 'addCharacter.customCode'
        }
    },

    // Minimum overall similarity to consider as update
    overallThreshold_Update: 0.5,

    // Minimum overall similarity to consider as fork
    overallThreshold_Fork: 0.75,

    // Additional files to check for changes if similarity is confirmed
    // These don't affect fork/update detection but are used for 
    // Additional files to check for changes if similarity is confirmed
    // These don't affect fork/update detection but are used for changelog
    additionalFiles: [
        {
            filename: 'avatar.json',
            characterDataPath: 'addCharacter.avatar',
            emptyContent: { "avatar": {} }
        },
        {
            filename: 'loreBooksUrls.json',
            characterDataPath: 'addCharacter.loreBooksUrls',
            emptyContent: []
        },
        {
            filename: 'systemCharacter.json',
            characterDataPath: 'addCharacter.systemCharacter',
            emptyContent: { "avatar": {} }
        },
        {
            filename: 'scene.json',
            characterDataPath: 'addCharacter.scene',
            emptyContent: {
                "background": {
                    "url": ""
                },
                "music": {
                    "url": ""
                }
            }
        }
    ]
};

// API Configuration and quotas
const API_CONFIG = {
    gemini: {
        token: process.env.GEMINI_TOKEN,
        model: 'gemini-1.5-flash',
        rateLimit: 45,  // Calls per minute
        maxCalls: 1000, // Maximum calls per day
        maxRetries: 3,  // Maximum retry attempts
        timeBetweenRetries: 3000, // Time in ms between retries
        endExecutionOnFail: true,  // Whether to stop execution if API fails
        skipExecutionOnFail: false // Whether to skip execution if API fails
    },
    pigimage: {
        token: process.env.PIGIMAGE_TOKEN,
        url: 'https://api.imagepig.com/',
        rateLimit: 2,
        maxCalls: 1,
        maxRetries: 3,
        timeBetweenRetries: 3000,
        endExecutionOnFail: false,
        skipExecutionOnFail: true
    },
    freeimage: {
        token: process.env.FREEIMAGE_TOKEN,
        url: 'https://freeimage.host/api/1/upload',
        rateLimit: -1,
        maxCalls: -1,
        maxRetries: 3,
        timeBetweenRetries: 3000,
        endExecutionOnFail: false,
        skipExecutionOnFail: true
    },
    cloudinary: {
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        api_key: process.env.CLOUDINARY_API_KEY,
        api_secret: process.env.CLOUDINARY_API_SECRET,
        folder: 'scrape/perchance_comments',
        rateLimit: 500,  // TODO - Change to 8
        maxCalls: 7500,  // TODO - Change to 250
        maxRetries: 3,
        timeBetweenRetries: 3000,
        endExecutionOnFail: false,
        skipExecutionOnFail: true
    }
};

// Default thresholds for NSFW content detection
const defaultNsfwThresholds = {
    Porn: 0.7,
    Sexy: 0.8,
    Hentai: 0.7
    // You can add or remove categories as needed
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
    updated: 0,
    forked: 0,
    missingImage: 0,
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
const crypto = require('crypto');
const stringSimilarity = require('string-similarity');
const glob = require('glob').sync;
const cloudinary = require('cloudinary').v2; // Import Cloudinary SDK
const { createCanvas, loadImage } = require('canvas');
const tf = require('@tensorflow/tfjs-node');
const nsfw = require('nsfwjs');
const axios = require('axios');
let nsfwModel = null;

const { GoogleGenerativeAI } = require("@google/generative-ai");

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
     * Move a file or directory to a new location
     * @param {string} source - Path to the file or directory
     * @param {string} destination - New path for the file or directory
     */
    static async move(source, destination, silence = false) {
        try {
            // Ensure the destination directory exists
            const destDir = path.dirname(destination);
            await fs.mkdir(destDir, { recursive: true });

            // Move the file or directory
            await fs.rename(source, destination);
        } catch (error) {
            if (!silence) console.error(`Error moving ${source} to ${destination}:`, error);
            throw error;
        }
    }

    /**
     * Copy a file or directory to a new location
     * @param {string} source - Path to the file or directory
     * @param {string} destination - New path for the file or directory
     */
    static async copy(source, destination) {
        try {
            // Ensure the destination directory exists
            const destDir = path.dirname(destination);
            await fs.mkdir(destDir, { recursive: true });

            // Copy the file or directory
            await fs.cp(source, destination, { recursive: true });
        } catch (error) {
            console.error(`Error copying ${source} to ${destination}:`, error);
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

        // Initialize quotas with default values for all APIs
        Object.keys(API_CONFIG).forEach(api => {
            this.quotas[api] = {
                dailyCalls: 0,
                lastReset: new Date().toISOString(),
                lastCall: new Date().toISOString()
            };
        });
    }

    /**
     * Initialize quotas from file or create new
     */
    async init() {
        try {
            const savedQuotas = await FileHandler.readJson(this.quotaFile);

            // Merge saved quotas with default values for any missing APIs
            Object.keys(API_CONFIG).forEach(api => {
                if (!savedQuotas[api]) {
                    savedQuotas[api] = {
                        dailyCalls: 0,
                        lastReset: new Date().toISOString(),
                        lastCall: new Date().toISOString()
                    };
                }
            });

            this.quotas = savedQuotas;
            await this.saveQuotas();
        } catch (err) {
            console.error(`Error loading quotas:`, err);

            // Initial quota structure with lastCall tracking (suggested to be removed)
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
            console.log(`    Executing cooldown of ${maxCooldown}ms for critical API ${apiRequiringMaxCooldown}`);
            await new Promise(resolve => setTimeout(resolve, maxCooldown));
        }
    }

}

/* --------------------------- DUPLICATE HANDLING --------------------------- */

/**
 * Class to analyze character similarities and detect forks/updates
 */
class CharacterSimilarityChecker {
    // constructor(config = SIMILARITY_CONFIG, globalConfig = {}) {
    //     this.config = config;
    //     this.globalConfig = globalConfig;
    // }
    constructor() {
        this.config = CONFIG.SIMILARITY || SIMILARITY_CONFIG;
        this.globalConfig = CONFIG;
    }

    /**
     * Gets all existing character paths from the configured directories
     * @returns {Promise<Array<string>>} Array of paths to existing characters
     */
    async getAllExistingCharacterPaths() {
        const characterPaths = [];

        // Generate paths from CONFIG structure
        const basePath = this.globalConfig.OUTPUT_PATH;
        for (const pathKey of Object.keys(this.globalConfig.PATHS)) {
            const dirPath = path.join(basePath, this.globalConfig.PATHS[pathKey]);

            try {
                // Find character directories using glob pattern matching
                const characterDirs = glob(`${dirPath}/**/manifest.json`);

                // Add the directory containing each manifest.json
                for (const manifestPath of characterDirs) {
                    characterPaths.push(path.dirname(manifestPath));
                }
            } catch (error) {
                console.warn(`Warning: Could not search in ${dirPath}: ${error.message}`);
            }
        }

        return characterPaths;
    }

    /**
     * Analyzes a character against existing characters to detect forks/updates
     * @param {Object} characterData - JSON object containing character data
     * @param {string} characterName - Name of the character (for logging)
     * @param {string} authorName - Author of the character
     * @returns {Promise<Object>} Analysis results including fork/update status and changes
     */
    async analyzeCharacter(characterData, characterName, authorName, authorId) {
        // Get all existing character paths
        const existingCharPaths = await this.getAllExistingCharacterPaths();

        console.log(`        Checking ${characterName} by ${authorName} for similarity against ${existingCharPaths.length} existing characters`);

        let bestMatch = {
            path: null,
            similarity: 0,
            analysis: null
        };

        // Check against all existing characters
        for (const existingPath of existingCharPaths) {
            const analysis = await this.compareCharacterWithExisting(
                characterData,
                authorName,
                authorId,
                existingPath
            );

            if (analysis.overallSimilarity > bestMatch.similarity) {
                bestMatch = {
                    path: existingPath,
                    similarity: analysis.overallSimilarity,
                    analysis: analysis
                };
            }
        }

        return {
            ...bestMatch.analysis,
            bestMatchPath: bestMatch.path
        };
    }

    /**
     * Compares character data with an existing character file
     * @param {Object} characterData - JSON object containing character data
     * @param {string} authorName - Author of the character
     * @param {string} existingCharPath - Path to existing character
     * @returns {Promise<Object>} Comparison results
     */
    async compareCharacterWithExisting(characterData, authorName, authorId, existingCharPath) {
        const result = {
            isDuplicate: false,
            isFork: false,
            isUpdate: false,
            similarities: {},
            changes: [],
            overallSimilarity: 0
        };

        // Load existing character manifest to check author
        const existingMeta = await this.loadManifest(existingCharPath);

        // Check if same author (potential update)
        //console.log(`Checking authorName: ${authorName} against ${existingMeta.author}, and authorId: ${authorId} against ${existingMeta.authorId} for ${path.basename(existingCharPath)}`);
        result.isDuplicate = authorId === existingMeta.authorId || (authorName === existingMeta.author && authorName !== 'Anonymous');

        // Perform sequential similarity checks
        let totalSimilarity = 0;
        let checksPerformed = 0;
        let continueChecking = true;

        for (const [filename, config] of Object.entries(this.config.coreSimilarity)) {
            // Skip if we already failed a required check
            if (!continueChecking) break;

            // Get data from JSON using the configured path
            const newContent = this.getNestedProperty(characterData, config.characterDataPath) || '';

            // Get data from existing character file
            const existingContent = await this.readFileContent(
                path.join(existingCharPath, 'src', filename)
            );

            // Calculate similarity
            const similarity = this.calculateSimilarity(newContent, existingContent);
            result.similarities[filename] = similarity;

            // If required file doesn't meet threshold, stop checking
            if (config.required && similarity < config.threshold) {
                continueChecking = false;
                break;
            }

            // console.log(`Similarity for ${filename}: ${similarity}. Checks performed: ${checksPerformed}`);
            // if (filename === 'initialMessages.json') {
            //     console.log('\n\nNew:', newContent);
            //     console.log('Existing:', existingContent, '\n\n');
            // }

            totalSimilarity += similarity;
            checksPerformed++;

            // Record changes if files differ
            if (similarity < 1 && similarity > 0) {
                result.changes.push({
                    file: filename,
                    similarity: similarity,
                    type: 'MODIFIED'
                });
            }
        }

        // Calculate overall similarity
        result.overallSimilarity = checksPerformed > 0 ?
            totalSimilarity / checksPerformed : 0;

        // Determine if it's a update based on similarity thresholds
        result.isUpdate = result.isDuplicate &&
            result.overallSimilarity < 1 &&
            result.overallSimilarity >= this.config.overallThreshold_Update;

        // Determine if it's a fork based on similarity thresholds
        result.isFork = !result.isDuplicate &&
            result.overallSimilarity >= this.config.overallThreshold_Fork;

        // If it's a fork/update, check additional files for changes
        if (result.isFork || result.isUpdate) {
            const additionalChanges = await this.checkAdditionalFiles(
                characterData,
                existingCharPath
            );
            result.changes.push(...additionalChanges);
        }

        return result;
    }

    /**
     * Safely gets a nested property from an object using a path string
     * @param {Object} obj - Object to get property from
     * @param {string} path - Dot-notation path to property (e.g., 'addCharacter.roleInstruction')
     * @returns {any} Property value or undefined if not found
     */
    getNestedProperty(obj, path) {
        return path.split('.').reduce((prev, curr) => {
            return prev ? prev[curr] : undefined;
        }, obj);
    }

    /**
 * Calculates string similarity between two content strings
 * @param {string} newContent - The new content as a string
 * @param {string} existingContent - The existing content as a string
 * @returns {number} - Similarity score (0 to 1) where 1 is identical
 */
    calculateSimilarity(newContent, existingContent) {
        // If either input is not a string, convert to string
        const newStr = typeof newContent !== 'string' ? String(newContent) : newContent;
        const existingStr = typeof existingContent !== 'string' ? String(existingContent) : existingContent;

        // Try to parse as JSON (to check for empty JSON structures)
        let newParsed, existingParsed;
        let isNewJson = false, isExistingJson = false;

        try {
            newParsed = JSON.parse(newStr);
            isNewJson = true;
        } catch (e) {
            // Not valid JSON, use the string as is
        }

        try {
            existingParsed = JSON.parse(existingStr);
            isExistingJson = true;
        } catch (e) {
            // Not valid JSON, use the string as is
        }

        // If both are valid JSON, check if they're empty using isEmptyValue
        if (isNewJson && isExistingJson) {
            // If both are empty, they're identical
            if (this.isEmptyValue(newParsed) && this.isEmptyValue(existingParsed)) {
                return 1; // Maximum similarity
            }

            // If one is empty but the other isn't, they're completely different
            if (this.isEmptyValue(newParsed) || this.isEmptyValue(existingParsed)) {
                return 0; // No similarity
            }
        }

        // For non-JSON strings or non-empty JSON strings, preprocess and compare them
        return stringSimilarity.compareTwoStrings(
            this.preprocessContent(newStr),
            this.preprocessContent(existingStr)
        );
    }


    /**
     * Checks additional files for changes with improved JSON comparison
     * @param {Object} characterData - JSON object containing character data
     * @param {string} existingPath - Path to existing character
     * @returns {Promise<Array>} Array of detected changes
     */
    async checkAdditionalFiles(characterData, existingPath) {
        //console.log(`    Checking additional files for ${existingPath}`);
        const changes = [];

        for (const fileDef of this.config.additionalFiles) {
            // Extract new and existing content
            let newContent = this.getNestedProperty(characterData, fileDef.characterDataPath);
            let existingContent = await this.readFileContent(
                path.join(existingPath, fileDef.filename)
            );

            // Normalize empty content (null → empty object/array)
            newContent = newContent ?? fileDef.emptyContent;
            existingContent = existingContent ?? fileDef.emptyContent;

            // Ensure parsed JSON before formatting
            try {
                if (typeof existingContent === 'string') existingContent = JSON.parse(existingContent);
                if (typeof fileDef.emptyContent === 'string') fileDef.emptyContent = JSON.parse(fileDef.emptyContent);
            } catch (error) {
                console.warn(`Failed to parse existing content for ${fileDef.filename}:`, error);
            }

            // Calculate similarity using the new key-by-key comparison
            const similarity = this.calculateJsonSimilarity(newContent, existingContent);

            // console.log(`\n\nAdditional file similarity for ${fileDef.filename}: ${similarity}`);
            // console.log('New:', JSON.stringify(newContent, null, 2));
            // console.log('Existing:', JSON.stringify(existingContent, null, 2));
            // console.log('Empty template:', JSON.stringify(fileDef.emptyContent, null, 2));

            if (similarity < 1) {
                // Determine whether the change is an addition, removal, or modification
                const changeType = this.determineChangeType(
                    newContent,
                    existingContent,
                    fileDef.emptyContent
                );

                changes.push({
                    file: fileDef.filename,
                    type: changeType,
                    similarity: similarity
                });
            }
        }

        return changes;
    }

    /**
 * Determines the type of change by comparing new and existing content
 * @param {any} newContent - The new content
 * @param {any} existingContent - The existing content
 * @param {any} emptyContent - The template for empty content
 * @returns {string} - The type of change: 'ADDED', 'REMOVED', or 'MODIFIED'
 */
    determineChangeType(newContent, existingContent, emptyContent) {
        // Helper function to check if content is effectively empty
        const isEffectivelyEmpty = (content, emptyTemplate) => {
            // If content is null or undefined, it's empty
            if (content === null || content === undefined) return true;

            // Check if content is equal to the empty template
            const contentStr = JSON.stringify(content);
            const emptyStr = JSON.stringify(emptyTemplate);
            return contentStr === emptyStr;
        };

        // Check if new content is effectively empty (null, undefined, or equal to emptyContent)
        const isNewEmpty = isEffectivelyEmpty(newContent, emptyContent);

        // Check if existing content is effectively empty (null, undefined, or equal to emptyContent)
        const isExistingEmpty = isEffectivelyEmpty(existingContent, emptyContent);

        // Determine change type based on emptiness
        if (isExistingEmpty && !isNewEmpty) {
            return 'ADDED';      // Content was added (didn't exist before)
        } else if (!isExistingEmpty && isNewEmpty) {
            return 'REMOVED';    // Content was removed (existed before)
        } else {
            return 'MODIFIED';   // Content was changed
        }
    }

    /**
     * Calculates similarity between two JSON objects by comparing keys
     * @param {Object|Array} newContent - The new JSON content
     * @param {Object|Array} existingContent - The existing JSON content
     * @returns {number} - Similarity score (0 to 1) where 1 is identical
     */
    calculateJsonSimilarity(newContent, existingContent) {
        // Handle arrays differently from objects
        if (Array.isArray(newContent) && Array.isArray(existingContent)) {
            // If both are empty arrays, they're identical
            if (newContent.length === 0 && existingContent.length === 0) {
                return 1;
            }

            // If one is empty but the other isn't, they're completely different
            if (newContent.length === 0 || existingContent.length === 0) {
                return 0;
            }

            // For arrays, compare each item
            const totalItems = Math.max(newContent.length, existingContent.length);
            let similaritySum = 0;

            for (let i = 0; i < totalItems; i++) {
                // If item exists in both arrays, compare them
                if (i < newContent.length && i < existingContent.length) {
                    if (typeof newContent[i] === 'object' && typeof existingContent[i] === 'object') {
                        // Recursive comparison for nested objects
                        similaritySum += this.calculateJsonSimilarity(newContent[i], existingContent[i]);
                    } else {
                        // Direct comparison for primitive values
                        similaritySum += (newContent[i] === existingContent[i]) ? 1 : 0;
                    }
                }
                // If item exists in only one array, similarity is 0 for this item
            }

            return similaritySum / totalItems;
        }

        // Handle objects
        if (typeof newContent === 'object' && newContent !== null &&
            typeof existingContent === 'object' && existingContent !== null) {

            // Get all unique keys from both objects
            const allKeys = new Set([
                ...Object.keys(newContent),
                ...Object.keys(existingContent)
            ]);

            // If there are no keys, both are empty objects and identical
            if (allKeys.size === 0) {
                return 1;
            }

            let totalKeySimilarity = 0;

            // Compare each key
            for (const key of allKeys) {
                const newHasKey = key in newContent;
                const existingHasKey = key in existingContent;

                // Rule 1: If one content has a value for a key and other doesn't, similarity is 0 for this key
                if (newHasKey !== existingHasKey) {
                    totalKeySimilarity += 0;
                    continue;
                }

                const newValue = newContent[key];
                const existingValue = existingContent[key];

                // Rule 2: If both are empty (null, undefined, empty string, or empty object), similarity is 1 for this key
                const newValueEmpty = this.isEmptyValue(newValue);
                const existingValueEmpty = this.isEmptyValue(existingValue);

                if (newValueEmpty && existingValueEmpty) {
                    totalKeySimilarity += 1;
                    continue;
                }

                // Rule 3: If both have content, compare deeper
                if (typeof newValue === 'object' && newValue !== null &&
                    typeof existingValue === 'object' && existingValue !== null) {
                    // Recursive comparison for nested objects
                    totalKeySimilarity += this.calculateJsonSimilarity(newValue, existingValue);
                } else {
                    // Direct string comparison for primitive values
                    const newStr = String(newValue);
                    const existingStr = String(existingValue);
                    totalKeySimilarity += this.calculateSimilarity(newStr, existingStr);
                }
            }

            // Return average similarity across all keys
            return totalKeySimilarity / allKeys.size;
        }

        // If we got here, at least one isn't an object
        // Use the original similarity check for non-objects
        return this.calculateSimilarity(
            JSON.stringify(newContent, null, 2),
            JSON.stringify(existingContent, null, 2)
        );
    }

    /**
     * Determines if a value is considered "empty"
     * @param {any} value - The value to check
     * @returns {boolean} - True if the value is considered empty
     */
    isEmptyValue(value) {
        // Null or undefined
        if (value === null || value === undefined) return true;

        // Empty string
        if (typeof value === 'string' && value.trim() === '') return true;

        // Empty array
        if (Array.isArray(value) && value.length === 0) return true;

        // Empty object (no keys)
        if (typeof value === 'object' && Object.keys(value).length === 0) return true;

        return false;
    }

    /**
     * Preprocesses content for comparison
     * @param {string} content - File content
     * @returns {string} Preprocessed content
     */
    preprocessContent(content) {
        if (typeof content !== 'string') {
            content = String(content || '');
        }

        return content
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();
    }

    /**
     * Loads character manifest file
     * @param {string} charPath - Path to character directory
     * @returns {Promise<Object>} Manifest content
     */
    async loadManifest(charPath) {
        try {
            const manifest = await fs.readFile(
                path.join(charPath, 'manifest.json'),
                'utf8'
            );
            return JSON.parse(manifest);
        } catch (error) {
            return { author: null };
        }
    }

    /**
     * Reads file content
     * @param {string} filePath - Path to file
     * @returns {Promise<string|null>} File content or null if file doesn't exist
     */
    async readFileContent(filePath) {
        try {
            return await fs.readFile(filePath, 'utf8');
        } catch (error) {
            return null;
        }
    }

    /**
     * Updates changelog for an existing character based on detected changes
     * @param {string} characterPath - Path to character
     * @param {Array} changes - Array of detected changes
     * @returns {Promise<void>}
     */
    async updateChangelog(characterPath, changes) {
        try {
            // Define changelog path
            const changelogPath = path.join(characterPath, 'changelog.json');
            let changelog = {};

            try {
                // Try reading and parsing the existing changelog
                const content = await fs.readFile(changelogPath, 'utf8');
                changelog = JSON.parse(content);

                // Ensure the changelog format is correct
                if (!changelog.history || !Array.isArray(changelog.history)) {
                    console.warn('Invalid changelog. Creating a default structure.');
                    changelog = {
                        currentVersion: '1.0.0',
                        created: new Date().toISOString(),
                        lastUpdated: new Date().toISOString(),
                        history: []
                    };
                }
            } catch (error) {
                // If the file doesn't exist or is invalid, create a new changelog
                console.warn(`Error reading changelog: ${error.message}. Creating a new one.`);
                changelog = {
                    currentVersion: '1.0.0',
                    created: new Date().toISOString(),
                    lastUpdated: new Date().toISOString(),
                    history: []
                };
            }

            // Bump the version
            const newVersion = bumpVersion(changelog.currentVersion);

            // Add a new entry to the history
            changelog.history.push({
                version: newVersion,
                date: new Date().toISOString(),
                type: "update",
                changes: changes.map(change => `${change.type} - ${change.file} (similarity: ${Math.round(change.similarity * 100) / 100}%)`)
            });

            // Update metadata
            changelog.currentVersion = newVersion;
            changelog.lastUpdated = new Date().toISOString();

            // Write back to the file
            await fs.writeFile(changelogPath, JSON.stringify(changelog, null, 2));

            console.log(`Updated changelog for ${path.basename(characterPath)} to version ${newVersion}`);
        } catch (error) {
            console.error(`Error updating changelog: ${error.message}`);
        }
    }
}

/**
 * Example usage in your existing processCharacter function
 * @param {Object} characterData - Character data from JSON
 * @param {Object} metadata - Character metadata
 * @param {Object} CONFIG - Global configuration
 */
async function checkForForkAndUpdate(characterData, metadata, CONFIG) {
    // // Create similarity checker with configs
    // const similarityChecker = new CharacterSimilarityChecker(
    //     CONFIG.SIMILARITY || SIMILARITY_CONFIG,
    //     CONFIG
    // );

    // Analyze character against existing ones
    const analysis = await similarityChecker.analyzeCharacter(
        characterData,
        metadata.characterName,
        metadata.authorName,
        metadata.authorId
    );

    //console.log(`Full Analysis result for ${metadata.characterName}: ${JSON.stringify(analysis, null, 2)}`);
    // console.log(`Similarity analysis for ${metadata.characterName}:`, {
    //     isDuplicate: analysis.isDuplicate,
    //     isFork: analysis.isFork,
    //     isUpdate: analysis.isUpdate,
    //     overallSimilarity: analysis.overallSimilarity,
    //     bestMatch: analysis.bestMatchPath ? path.basename(analysis.bestMatchPath) : 'None'
    // });

    if (analysis.isDuplicate) {
        // Handle duplicate case
        //console.log(`Duplicate of existing character: ${metadata.characterName}`);

        // Set destination path to the same as the existing character
        return {
            isExisting: true,
            type: 'DUPLICATE',
            destinationPath: analysis.bestMatchPath,
            changes: analysis.changes,
            overallSimilarity: analysis.overallSimilarity,
            bestMatch: analysis.bestMatchPath ? path.basename(analysis.bestMatchPath) : 'None'
        };
    }

    if (analysis.isUpdate) {
        // Handle update case
        console.log(`Updating existing character changelog: ${metadata.characterName}`);

        // Update changelog with detected changes
        await similarityChecker.updateChangelog(analysis.bestMatchPath, analysis.changes);

        // Set destination path to the same as the existing character
        return {
            isExisting: true,
            type: 'UPDATE',
            destinationPath: analysis.bestMatchPath,
            changes: analysis.changes,
            overallSimilarity: analysis.overallSimilarity,
            bestMatch: analysis.bestMatchPath ? path.basename(analysis.bestMatchPath) : 'None'
        };
    }

    if (analysis.isFork) {
        // Handle fork case
        //console.log(`Found fork of existing character: ${metadata.characterName}`);

        // Get base path of original character to use in manifest
        const originalCharName = path.basename(analysis.bestMatchPath);

        return {
            isExisting: false,
            type: 'FORK',
            forkedFrom: originalCharName,
            forkedPath: analysis.bestMatchPath,
            similarities: analysis.similarities,
            changes: analysis.changes,
            overallSimilarity: analysis.overallSimilarity,
            bestMatch: analysis.bestMatchPath ? path.basename(analysis.bestMatchPath) : 'None'
        };
    }

    // Not a fork or update
    return {
        isExisting: false,
        type: 'NEW'
    };
}

/* -------------------------------------------------------------------------- */
/*                                  API CALLS                                 */
/* -------------------------------------------------------------------------- */

async function uploadImage_old(img, api = 'freeimage') {

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
            if (API_CONFIG[api].endExecutionOnFail) {
                console.error(`${api} API quota exceeded. Halting execution.`);
                process.exit(0);
            } else {
                console.warn(`    ${api} API quota exceeded.`);
                return null;
            }
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

/**
 * Uploads an image to Cloudinary with optimization
 * @param {string} img - Base64 image data or data URL
 * @param {string} api - API service to use (default: 'cloudinary')
 * @returns {Promise<string|null>} - URL of the uploaded image or null if failed
 */
async function uploadImage(img, fileName = null, api = 'cloudinary') {
    try {
        // Configure Cloudinary with credentials from API_CONFIG
        cloudinary.config({
            cloud_name: API_CONFIG.cloudinary.cloud_name,
            api_key: API_CONFIG.cloudinary.api_key,
            api_secret: API_CONFIG.cloudinary.api_secret
        });

        // After the cloudinary.config() call
        if (!API_CONFIG.cloudinary.api_key) {
            console.error('Cloudinary API key not found in environment variables');
            process.exit(1);
        }

        if (!(await quotaManager.checkQuota(api))) {
            if (API_CONFIG[api].endExecutionOnFail) {
                console.error(`${api} API quota exceeded. Halting execution.`);
                process.exit(1);
            } else if (API_CONFIG[api].skipExecutionOnFail) {
                console.warn(`    ${api} API quota exceeded. Skipping execution.`);	
                return null;
            } else {
                console.warn(`    ${api} API quota exceeded.`);
                return null;
            }
        }

        // Handle base64 data URL format
        let imgData = img;
        let originalFormat = 'jpeg'; // Default format

        if (img.includes('base64,')) {
            // Get the format from the data URL
            const formatMatch = img.match(/data:image\/([a-zA-Z0-9]+);base64,/);
            originalFormat = formatMatch ? formatMatch[1].toLowerCase() : 'jpeg';
        } else {
            // If it's just base64 without the data URL prefix, add it back
            imgData = `data:image/jpeg;base64,${img}`;
        }

        // Calculate size of the original image in KB
        const originalBase64Data = imgData.split('base64,')[1];
        const originalSizeInBytes = Buffer.from(originalBase64Data, 'base64').length;
        const originalSizeInKB = Math.round(originalSizeInBytes / 1024);

        //console.log(`Original image: ${originalFormat}, ${originalSizeInKB}KB`);

        // Optimize image
        let optimizationResult;
        let uploadDataURL;
        let uploadFormat = 'webp'; // Default upload format

        try {
            // Try to optimize to WebP with default configuration
            optimizationResult = await optimizeImage(imgData);

            // Only use the optimized image if it's actually smaller
            if (optimizationResult.sizeInKB < originalSizeInKB) {
                uploadDataURL = optimizationResult.dataURL;
                uploadFormat = optimizationResult.format;
                console.log(`    Using optimized image: ${optimizationResult.sizeInKB}KB (${Math.round((1 - optimizationResult.sizeInKB / originalSizeInKB) * 100)}% smaller)`);
            } else {
                console.log(`    Optimized image (${optimizationResult.sizeInKB}KB) is larger than original (${originalSizeInKB}KB). Using original.`);
                uploadDataURL = imgData;
                uploadFormat = originalFormat;
            }
        } catch (error) {
            console.error('   Error optimizing image:', error.message);
            // Continue with the original image if optimization fails
            uploadDataURL = imgData;
            uploadFormat = originalFormat;
        }

        // Extract the base64 data without the prefix for Cloudinary upload
        const base64Data = uploadDataURL.split('base64,')[1];
        const sanitizedFileName = fileName ? fileName.replace(/\s+/g, "_").trim() : `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const imgName = `img_${sanitizedFileName}`;

        // Upload to Cloudinary using the SDK with explicit format
        const uploadResult = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload(
                `data:image/${uploadFormat};base64,${base64Data}`,
                {
                    folder: API_CONFIG.cloudinary.folder,
                    resource_type: 'image',
                    // Explicitly set output format to WebP to avoid automatic conversion to PNG
                    format: 'webp',
                    // Generate a unique public ID based on timestamp and random string
                    public_id: imgName,
                    // Apply some basic transformations
                    transformation: [
                        { quality: "auto:good" } // Use Cloudinary's automatic quality setting
                    ]
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            );
        });

        await quotaManager.incrementQuota(api);
        console.log('    Successfully uploaded image to Cloudinary.'); // \n    URL:', uploadResult.secure_url);

        // Return the secure HTTPS URL
        return uploadResult.secure_url;
    } catch (error) {
        console.error('Error on sending image to Cloudinary:', error.message);
        if (API_CONFIG[api].endExecutionOnFail) {
            console.error('Critical API failure. Halting execution.');
            process.exit(1);
        } else {
            // Executing 2 seconds pause
            console.error('\nClodinary error. Executing 2 seconds pause before proceeding.');
            await quotaManager.incrementQuota(api);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return null;
    }
}

async function generateImage(aiAnalysis, api = 'pigimage') {

    const prompt = aiAnalysis.prompt;

    // Return if prompt is blank
    if (!prompt || prompt.trim() === '') return null;

    if (!(await quotaManager.checkQuota(api))) { // Check for quota
        if (API_CONFIG[api].endExecutionOnFail) {
            console.error(`${api} API quota exceeded. Halting execution.`);
            process.exit(1);
        } else if (API_CONFIG[api].skipExecutionOnFail) {
            console.warn(`    ${api} API quota exceeded. Skipping execution.`);	
            return null;
        } else {
            console.warn(`    ${api} API quota exceeded.`);
            return null;
        }
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
        "rating": ["sfw"],
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
async function classifyCharacter(roleInstruction = '', reminder = '', userRole = '', characterName = '', userCharacterName = '', categories, folder, output = 'default', api = 'gemini') {

    // Check Gemini API quota
    if (!(await quotaManager.checkQuota('gemini'))) {
        if (API_CONFIG[api].endExecutionOnFail) {
            console.error(`${api} API quota exceeded. Halting execution.`);
            process.exit(0);
        } else if (API_CONFIG[api].skipExecutionOnFail) {
            console.warn(`    ${api} API quota exceeded. Skipping execution.`);	
            return null;
        } else {
            console.warn(`    ${api} API quota exceeded.`);
            return null;
        }
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
    let prompt;

    if (output === 'stableDiffusion') {
        prompt = `Generate a Stable Diffusion image generation prompt by carefully analyzing the character data provided using the following structure:

        ### Output Format:
        The result must be structured as a JSON object with two fields:  
        1. **Prompt (prompt)**:  
        - **Type**: string  
        - **Purpose**: A vivid, immersive text prompt with weighted keywords embedded naturally.  
        2. **Negative prompt (negativePrompt)**:  
        - **Type**: string  
        - **Purpose**: A comma-separated list of weighted keywords specifying elements to strictly avoid in the image.  

        ### Prompt Generation Instructions:
        1. **Analyze** the character data thoroughly.  
        2. **Extract** key visual and personality traits. 
        3. **Craft** a **highly descriptive** and immersive text prompt that vividly portrays the character.  Add seemly obvious information, as gender, species (if not human), etc.
        4. **Seamlessly integrate** weighted keywords within the descriptive text.  
        5. **Ensure the best image style based on the character’s source material.**  
        - (Movie: photorealistic), (Anime: anime-style), (Game: digital painting or 3D render).  
        - **If the source is unclear, default to semi-realistic art.**  
        6. **Maintain coherence** in setting, expression, and overall composition.  

        ### Weighted Keyword Formatting Guide:
        - Use **(keyword:weight)** format to control emphasis.  
        - Example: **(detailed face:1.3)** increases detail, while **(femininity:0.7)** makes it less feminine.  
        - Strong negative weights **discourage unwanted elements**, e.g., **(low quality:1.7)**.  
        - **DO NOT** use weights above 2.0.  

        ### **ATTENTION:**
        - **DO NOT** include Markdown, extra formatting, explanations, or anything outside the JSON response.  
        - When applicable and within the AI's internal guidelines, generate NSFW descriptions with the highest level of detail allowed.  

        ### **Return Format:**
        Return a **pure stringified JSON** object with the following structure:  
        {
            "prompt": "<Detailed and immersive text prompt>",
            "negativePrompt": "<Comma-separated list of weighted keywords specifying elements to strictly avoid>"
        }

        ### Example JSON Output:
        - Return a **pure stringified JSON** object with the following structure:
        {
            "prompt": "AA formidable (male:1.8) warrior named Viktor stands in a mystical forest, his (short silver hair:1.5) tousled by the wind, gleaming under the cold glow of the (moonlight:1.2). His (sharp, chiseled jawline:1.4) and (piercing blue eyes:1.3) radiate an unwavering intensity, exuding strength and command. His (rugged, battle-worn face:1.4) carries the marks of countless victories. Clad in (heavy, battle-scarred fantasy armor:1.5), the engraved metallic plates bear the weight of history and power. A (tattered yet majestic cape:1.3) billows behind him, reinforcing his imposing presence. The background, a (storm-laden sky:1.1), crackles with distant lightning, casting dramatic shadows over the battlefield. Embers and dust swirl in the air, remnants of a fierce conflict. The scene is captured with (cinematic lighting:1.3), ensuring a breathtaking, heroic composition. (portrait:1.3)",
            "negativePrompt": "(low quality:2.0), (blurry details:1.5), (distorted anatomy:1.8), (extra limbs:2.0), (bad proportions:1.7), (androgynous:1.8), (feminine features:2.0), (soft facial structure:1.8), (slender physique:1.7), (delicate hands:1.8), (thin limbs:1.7), (narrow shoulders:1.8), (weak jawline:2.0), (small frame:1.8)"
        }

        ### Character's data to generate the stable diffusion prompt:

        Here is the character ${characterName ? ' (' + characterName + ') ' : ''} description:
        ${roleInstruction.replace('{{char}}', characterName).replace('{{user}}', userCharacterName)}

        Here is the character reminder:
        ${reminder.replace('{{char}}', characterName).replace('{{user}}', userCharacterName)}
        `;
    } else {
        prompt = `
        Analyze the following character data and perform a comprehensive validation using the following structure:

        ### **Validation Criteria**
        1. **Rating (rating)**:
        - **Type**: string (enum: "sfw" | "nsfw")
        - **Purpose**: Indicates whether the character is Safe for Work (SFW) or Not Safe for Work (NSFW).
        
        2. **Character State (charState)**:
        - **Type**: string (enum: "valid" | "invalid" | "quarantine")
        - **Purpose**:
            - "valid": Default. Character has complete, appropriate, and coherent data.
            - "invalid": Character is nonsensical, trolling, or otherwise unusable.
            - "quarantine": Character contains ILLEGAL content (distinct from merely immoral or NSFW content).

        3. **Description (description)**:
        - **Type**: string
        - **Purpose**: A concise, one-paragraph description of the character.

        4. **State Reason (stateReason)**:
        - **Type**: string
        - **Purpose**: If the character is "invalid", "quarantine", or requires manual review, this must explains why.

        5. **Manual Review (needsManualReview)**:
        - **Type**: boolean
        - **Purpose**: 
            - true: The character **lacks sufficient data** to be processed.
            - false: Default value.

        6. **Categories (categories)**:
        - **Type**: object<string, array<string>>
        - **Purpose**: Each category name is a key, and its value is an array of matching tags.
        - **Rules**:
            - Always in lower case
            - Use multiple tags from each category as needed.
            - Categories marked (required: true) must always be present.
            - Categories marked (nsfw_only: true) apply only to NSFW characters.
            - Tags must be selected from either 'general' or 'nsfw' lists based on the character.
            - You can create new categories and tags when necessary if a relevant and similar option does not exist, as long as they follow a logical structure and improve classification.

        ### **ATTENTION:**
        - **DO NOT** include Markdown, extra formatting, explanations, or anything outside the JSON response.
        - Your analysis must be rely on legality rather than morality.

        ### **Return Format**:
        - Return a **pure stringified JSON** object with the following structure:
        {
            "rating": "sfw" | "nsfw",
            "description": "<Concise one-paragraph summary>",
            "needsManualReview": boolean,
            "charState": "valid" | "invalid" | "quarantine",
            "stateReason": "<If not valid or needs manual review, explain why>",
            "categories": {
                "<category_name>": ["<matching tags>"]
            }
        }

        ### Character's data:

        Here is the character ${characterName ? ' (' + characterName + ') ' : ''} description:
        ${roleInstruction.replace('{{char}}', characterName).replace('{{user}}', userCharacterName)}

        Here is the character reminder:
        ${reminder.replace('{{char}}', characterName).replace('{{user}}', userCharacterName)}

        Here is the role user ${userCharacterName ? ' (' + userCharacterName + ') ' : ''} plays with this character ${characterName ? ' (' + characterName + ') ' : ''}:
        ${userRole.replace('{{char}}', characterName).replace('{{user}}', userCharacterName)}

        Available categories:
        ${JSON.stringify(categoriesMap, null, 2)}
        `;
    }

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
        if ((!parsedJson.prompt || !parsedJson.negativePrompt) && (!parsedJson.description || !parsedJson.categories)) {
            throw new Error('Missing required fields in response');
        }

        await quotaManager.incrementQuota(api);

        // Fix rating array issues
        return fixRating(parsedJson);

    } catch (error) {

        // Handle API-specific errors
        if (error.message.includes('API key not valid')) {
            console.error('\nGemini - Invalid API key. Check your configuration.');
        } else if (error.message.includes('400 Bad Request')) {
            console.error('\nGemini - Bad request. Verify input data and prompt format.');
        } else if (error.message.includes('Response was blocked due to PROHIBITED_CONTENT')) {
            console.error('\nGemini - Response was blocked due to PROHIBITED_CONTENT.');
            FileHandler.writeJson(path.join(CONFIG.SOURCE_PATH, folder, '_prohibitedContent.json'), [])
            await quotaManager.incrementQuota(api);
        } else if (error.message.includes('429 Too Many Requests')) {
            console.error('\nGemini - Too Many Requests. Executing 2 seconds pause before proceeding.');
            await quotaManager.incrementQuota(api);
            await new Promise(resolve => setTimeout(resolve, 2000));
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

// Function to fix rating format in the JSON object
function fixRating(parsedJson) {
    // Create a copy of the original object to avoid modifying it directly
    const result = { ...parsedJson };

    // Process the rating outside of categories
    if (result.rating) {
        result.rating = processRating(result.rating);
    }

    // Process the rating inside categories
    if (result.categories) {
        // Create a copy of categories to maintain other category values
        result.categories = { ...result.categories };

        // Process Rating category if it exists
        if (result.categories.Rating) {
            result.categories.Rating = processRating(result.categories.Rating);
        }
    }

    return result;
}

/* -------------------------------------------------------------------------- */
/*                                PATH HANDLING                               */
/* -------------------------------------------------------------------------- */

/**
 * Get list of character folders to process
 */
async function getNewCharacterFolders() {
    try {
        // Read directory contents
        const folders = await fs.readdir(CONFIG.SOURCE_PATH);

        // Filter out hidden files (starting with '.')
        const filteredFolders = folders.filter(folder => !folder.startsWith('.'));

        // Log found files/folders for debugging
        //console.log("Found files/folders:", filter);

        //return filter;

        // Get each folder statistic to sort by creation date
        const foldersWithStats = await Promise.all(
            filteredFolders.map(async folder => {
                const fullPath = path.join(CONFIG.SOURCE_PATH, folder);
                const stats = await fs.stat(fullPath);
                return { name: folder, birthtime: stats.birthtime };
            })
        );

        // Order by creation date (Older first)
        foldersWithStats.sort((a, b) => a.birthtime - b.birthtime);

        // Return only odered folder names
        return foldersWithStats.map(folder => folder.name);


    } catch (err) {
        console.error(`Error reading directory ${CONFIG.SOURCE_PATH}:`, err.message);
        throw err;
    }
}

/**
 * Get list of character folders to process
 */
async function getExistingCharacterFolders() {
    try {
        // Read directory contents
        const folders = await fs.readdir(CONFIG.SOURCE_PATH);

        // Filter out hidden files (starting with '.')
        const filteredFolders = folders.filter(folder => !folder.startsWith('.'));

        // Log found files/folders for debugging
        //console.log("Found files/folders:", filter);

        return filter;


    } catch (err) {
        console.error(`Error reading directory ${CONFIG.SOURCE_PATH}:`, err.message);
        throw err;
    }
}

/**
 * Determine destination path based on AI analysis
 * @param {object} aiAnalysis - Analysis results from AI
 */
function determineDestinationPath(aiAnalysis, isNsfw = false) {

    // Ensure the keys are valid
    const charState = aiAnalysis.charState ? aiAnalysis.charState.toLowerCase() : null;
    const manualReview = aiAnalysis.needsManualReview ? aiAnalysis.needsManualReview : null;
    const rating = Array.isArray(aiAnalysis.rating)
        ? aiAnalysis.rating.find(item => ['sfw', 'nsfw'].includes(item.toLowerCase()))?.toLowerCase()
        : (typeof aiAnalysis.rating === 'string' ? aiAnalysis.rating.toLowerCase() : null);

    // Gets parent directory of source path
    const parentDir = path.dirname(CONFIG.SOURCE_PATH);

    // Send to manual review
    if (manualReview) {
        filePath = path.join(CONFIG.OUTPUT_PATH, CONFIG.PATHS.MANUAL_REVIEW);
        //FileHandler.writeJson(path.join(filePath, folder, 'aiAnalysis.json'), aiAnalysis)
        return filePath;
    }

    // Check the state
    if (charState === 'valid') {
        // If valid, send to the appropriate folder
        return rating === 'sfw' && !isNsfw
            ? path.join(CONFIG.OUTPUT_PATH, CONFIG.PATHS.VALIDATED_SFW)
            : path.join(CONFIG.OUTPUT_PATH, CONFIG.PATHS.VALIDATED_NSFW);
    } else {
        // If not valid, send to invalid or quarantine
        if (charState === 'quarantine') {
            return path.join(parentDir, CONFIG.PATHS.QUARANTINE);
        } else if (aiAnalysis.charState.toLowerCase() === 'invalid') {
            return path.join(parentDir, CONFIG.PATHS.DISCARDED_INVALID);
        } else {
            return path.join(parentDir, CONFIG.PATHS.DISCARDED_ERROR);
        }
    }
}


/* -------------------------------------------------------------------------- */
/*                             DUPLICATE HANDLING                             */
/* -------------------------------------------------------------------------- */

/**
 * Check if character already exists in output directory
 * @param {string} folder - Character folder name
 * @returns {Promise<boolean>} - Whether character exists
 */
async function checkDuplicateLinksAndFolder(metadata, existingLinks, folderName) {
    try {

        // Get all paths from CONFIG.PATHS dynamically
        const possiblePaths = Object.values(CONFIG.PATHS);

        // Set variables
        const folder = metadata.folderName || folderName;
        const link = metadata.link;

        // Checking for folders with same name
        for (const checkPath of possiblePaths) {
            const ckPath = path.join(checkPath, folder);
            const fullPath = path.join(CONFIG.OUTPUT_PATH, ckPath);
            try {
                await fs.access(fullPath);
                //console.log(`Found duplicate folder on ${fullPath}`);
                return { duplicatePath: fullPath, duplicateType: "folder" };
            } catch {
                // Path doesn't exist, continue checking
            }
        }

        // Check for repeating links in existingLinks
        const duplicateLink = existingLinks.find(existing =>
        (
            existing.shareUrl === link ||
            (existing.shareLinkFileHash &&
                existing.shareLinkFileHash === metadata.shareLinkFileHash)
        )
        );

        if (duplicateLink) {
            console.log(`Duplicate link found in ${duplicateLink.path}`);
            return { duplicatePath: duplicateLink.path, duplicateType: "link" };
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
async function removeDuplicate(folder, existingPath, metadata, fileHash = null) {
    try {
        const sourcePath = path.join(CONFIG.SOURCE_PATH, folder)
        // Gets parent directory of source path
        const parentDir = path.dirname(CONFIG.SOURCE_PATH);
        const duplicatePath = path.join(parentDir, CONFIG.PATHS.DISCARDED_DUPLICATE, folder);
        let referenceContent;

        if (fileHash && !existingPath) {
            referenceContent = {
                originPath: sourcePath,
                existingHash: fileHash,
                destinationPath: duplicatePath,
                duplicateDate: new Date().toISOString()
            };
        } else if (!fileHash && existingPath) {
            referenceContent = {
                originPath: sourcePath,
                existingPath: existingPath,
                destinationPath: duplicatePath,
                duplicateDate: new Date().toISOString()
            }
        } else {
            referenceContent = {
                originPath: sourcePath,
                existingPath: existingPath,
                existingHash: fileHash,
                destinationPath: duplicatePath,
                duplicateDate: new Date().toISOString()
            }
        }

        const newMetadata = [{ ...metadata }];
        const fileId = metadata.fileId

        // Move duplicated files
        console.log(`    Moving and copying duplicated character files from: "${sourcePath}" to "${duplicatePath}"`)

        try {
            // Move gz file
            await FileHandler.move(
                path.join(sourcePath, fileId),
                path.join(duplicatePath, fileId),
                true
            );
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.warn(`  File Id ${fileId} was not found to delete on ${folder}.`);
            } else {
                throw error;
            }
        }

        // Copy captured message
        await FileHandler.copy(
            path.join(sourcePath, 'capturedMessage.json'),
            path.join(duplicatePath, 'capturedMessage.json')
        );

        // Write jsons
        await FileHandler.writeJson(path.join(duplicatePath, 'duplicate_reference.json'), referenceContent);
        await FileHandler.writeJson(path.join(duplicatePath, 'metadata.json'), newMetadata);

    } catch (error) {
        console.error(`Error handling duplicate character ${folder}:`, error);
        throw error;
    }
}

/**
 * Calculate the hash of a given file buffer.
 * @param {Buffer} fileBuffer - The file data as a Buffer.
 * @param {string} algorithm - The hash algorithm (default: 'sha256').
 * @returns {Promise<string>} The computed hash as a hexadecimal string.
 */
async function calculateFileHash(fileBuffer, algorithm = 'sha256') {
    // console.log('Calculating file hash...');
    try {
        // Create a hash instance
        const hash = crypto.createHash(algorithm);

        // Update hash with the file data
        hash.update(fileBuffer);
        const fileHash = hash.digest('hex');
        // Return the final hash as a hex string
        // console.log('File hash calculated successfully:', fileHash);
        return fileHash;
    } catch (error) {
        console.error('Error calculating file hash:', error.message);
        throw error;
    }
}


// Function to check if a file hash already exists in the links array
function checkForDuplicateHash(existingLinks, fileHash) {
    // Return false if no hash provided
    if (!fileHash) return false;

    // Check if hash exists in existingLinks
    const isDuplicate = existingLinks.some(existing =>
        existing && existing.shareLinkFileHash &&
        existing.shareLinkFileHash === fileHash
    );

    return isDuplicate;
}

/* -------------------------------------------------------------------------- */
/*                          CHARACTER FILES HANDLING                          */
/* -------------------------------------------------------------------------- */

/**
 * Extract character data from gz file
 * @param {string} folder - Character folder name
 * @param {string} fileName - File name
 */
async function extractCharacterData(folder, fileName, existingLinks, retry = false) {
    //console.log(`Extracting character data from ${fileName} in folder ${folder}`);
    //console.log(`folder: ${folder}, fileName: ${fileName}`);
    const gzPath = path.join(CONFIG.SOURCE_PATH, folder, fileName);
    let gzBuffer;

    try {
        // Attempt to read the gzipped file
        gzBuffer = await fs.readFile(gzPath);
    } catch (error) {
        // If the file is not found, trigger download
        if (error.code === 'ENOENT') {
            console.error(`    File ${fileName} not found. Downloading...`);
            await downloadFile(folder, fileName);  // Implement the actual download function
            gzBuffer = await fs.readFile(gzPath);  // Try reading again after downloading
        } else {
            // Re-throw other errors (e.g., permission issues)
            throw error;
        }
    }

    // Calculate file hash
    const hash = await calculateFileHash(gzBuffer);

    if (checkForDuplicateHash(existingLinks, hash)) {
        console.log(`           Duplicate file hash found for: ${fileName}`);
        return { characterData: 'duplicate', fileHash: hash };
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
                return { characterData: null, fileHash: null };  // Return null to indicate failure
            }

            // Download the file and attempt extraction again
            await downloadFile(folder, fileName);
            const retryResult = await extractCharacterData(folder, fileName, existingLinks, true);
            return {
                characterData: retryResult.characterData,
                fileHash: retryResult.fileHash || hash
            };
        } else {
            // Re-throw any other unexpected errors
            throw error;
        }
    }

    // Return the uncompressed data as a JSON object
    return { characterData: JSON.parse(unzipped.toString()), fileHash: hash };
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
            throw new Error(`        Download failed: ${response.status}`);
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
        console.error('        Failed to download file:', error.message);
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
async function createCharacterStructure(folder, metadata, message, characterData, aiAnalysis, destinationPath, img, bgImg, fileHash, forkAnalysis) {

    // Create character files
    const importFileName = `character_${folder}.gz`
    const characterInfo = characterData.addCharacter || {};
    const charFiles = await createCharacterFiles(characterInfo, importFileName, img, bgImg)

    // Create manifest
    const manifest = createManifest(metadata, message, characterData, aiAnalysis, charFiles, destinationPath, folder, importFileName, fileHash, forkAnalysis);

    // Prepare files to commit
    const filename = metadata.fileId;
    const files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        [filename]: await util.promisify(gzip)(JSON.stringify(characterData))
    };

    // Create and add changelog only if it's NOT an update
    if (forkAnalysis.type !== 'UPDATE') {
        files['changelog.json'] = JSON.stringify(createChangelog(message), null, 2);
    }

    // Add character files to the list of files
    Object.entries(charFiles).forEach(([filePath, content]) => {
        files[filePath] = content;
    });

    // Write files to destination // TODO - fix all fs. uses fs.mkdir/fs.writeFile
    //const destFolder = path.join(CONFIG.OUTPUT_PATH, destinationPath, folder);
    const destFolder = path.join(destinationPath, folder);
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
    if (aiAnalysis?.charState?.toLowerCase() === 'valid' && !aiAnalysis?.needsManualReview) {
        await updateCharacterIndex(destFolder, manifest);
    }

    // Log the character path
    console.log("    Character path:", destFolder);
}

/**
 * Create individual files for each character attribute and zip file
 * @param {Object} characterInfo - Dictionary containing character information
 * @param {string} dirName - Directory name for the character files
 * @param {string} fileName - A name for files, in a pattern 'Character by Author'
 * @returns {Promise<Object>} Dictionary of created files and their content
 */
async function createCharacterFiles(characterInfo, importFileName, img, bgImg) {
    console.log("\n    Creating character files:")

    // Replace avatar.url with img if avatar exists
    if (characterInfo.avatar && typeof characterInfo.avatar === 'object' && img) {
        characterInfo.avatar.url = img;
    }

    // Replace background.url with img if bgImg exists
    if (characterInfo.scene && typeof characterInfo.scene === 'object' && bgImg) {
        characterInfo.scene.background.url = bgImg;
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
    for (const [field, formatType] of Object.entries(fieldFormats)) {
        if (characterInfo[field]) {
            let content = characterInfo[field];

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
function createManifest(metadata, message, characterData, aiAnalysis, charFiles, destinationPath, folder, importFileName, fileHash, forkAnalysis) {

    console.log("    Creating manifest")

    // Extract avatar
    const avatar = charFiles[path.join('src', 'avatar.json')];
    const imgUrl = JSON.parse(avatar).url

    // Set download path
    //const downloadPath = path.join(CONFIG.OUTPUT_PATH, destinationPath, folder, importFileName).replace(/\\/g, '/');
    const downloadPath = path.join(destinationPath, folder, importFileName).replace(/\\/g, '/');

    return {
        name: characterData?.addCharacter?.name || '',
        description: aiAnalysis.description,
        author: message.username || message.userNickname || 'Anonymous',
        authorId: message.publicId,
        source: 'SCRAPER',
        imageUrl: imgUrl || '',
        shareUrl: metadata.link,
        shareLinkFileHash: fileHash || '',
        downloadPath: downloadPath,
        forkedFrom: forkAnalysis.forkedPath || '',
        shapeShifter_Pulls: 0,
        galleryChat_Clicks: 0,
        galleryDownload_Clicks: 0,
        groupSettings: {
            requires: [],
            recommends: []
        },
        features: {
            customCode: charFiles[path.join('src', 'customCode.js')] ?
                //[path.join(CONFIG.OUTPUT_PATH, destinationPath, folder, 'src', 'customCode.js')] : [],
                [path.join(destinationPath, folder, 'src', 'customCode.js')] : [],
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
    console.log("    Updating index.json");
    const indexPath = path.join(CONFIG.OUTPUT_PATH, 'index.json').replace(/\\/g, '/');

    try {
        try {
            await fs.access(indexPath);
        } catch {
            console.log(`Index.json file missing on ${indexPath}.\nCreating a new one.`);
            await fs.writeFile(indexPath, JSON.stringify([]));
        }

        const indexContent = await fs.readFile(indexPath, 'utf8');
        const indexData = JSON.parse(indexContent);

        // const relativePath = path.relative(CONFIG.OUTPUT_PATH, characterPath);
        // const newEntry = { path: relativePath, manifest };

        const newEntry = { path: characterPath, manifest };

        //const existingIndex = indexData.findIndex(item => item.path === relativePath);
        const existingIndex = indexData.findIndex(item => item.path === characterPath);
        if (existingIndex !== -1) {
            indexData[existingIndex] = newEntry;
        } else {
            indexData.push(newEntry);
        }

        console.log("    Writing updated index.json to:", indexPath);
        await fs.writeFile(indexPath, JSON.stringify(indexData, null, 2));
    } catch (error) {
        console.error('Error updating index.json:', error);
        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/*                            CHARACTER PROCESSING                            */
/* -------------------------------------------------------------------------- */

// Initialize the NSFW model (call this at the beginning of your application)
async function initializeNSFWModel() {
    if (!nsfwModel) {
        nsfwModel = await nsfw.load();
        console.log("NSFW detection model loaded successfully");
    }
    return nsfwModel;
}

/**
 * Helper function to safely load images from various sources
 * @param {string} source - URL, base64 string or file path
 * @returns {Promise<Object>} - Image data in a format usable by TensorFlow
 */
async function safeLoadImage(source) {
    try {
        // For URLs, download the image first to handle potential format issues
        if (source.startsWith('http') || source.startsWith('https')) {
            //console.log(`Loading image from URL: ${source}`);

            // Get the image data via axios
            const response = await axios.get(source, { responseType: 'arraybuffer' });

            // Get the content type from headers (for debugging)
            const contentType = response.headers['content-type'];
            //console.log(`Image content type: ${contentType}`);

            // For TensorFlow.js we can use the buffer directly
            return tf.node.decodeImage(new Uint8Array(response.data), 3);
        }
        // For base64 images
        else if (source.startsWith('data:image')) {
            //console.log('Loading image from base64 string');
            const img = await loadImage(source);
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            return tf.browser.fromPixels(canvas);
        }
        // For file paths
        else {
            //console.log(`Loading image from file: ${source}`);
            const data = await fs.readFile(source);
            return tf.node.decodeImage(new Uint8Array(data), 3);
        }
    } catch (error) {
        // Create a detailed error log
        console.error(`Error loading image from ${source.substring(0, 50)}...`);
        console.error(`Error type: ${error.name}`);
        console.error(`Error message: ${error.message}`);

        if (error.response) {
            console.error(`HTTP Status: ${error.response.status}`);
            console.error(`Response headers:`, error.response.headers);
        }

        throw error;
    }
}

/**
 * Checks an array of images for NSFW content
 * @param {Array} images - Array of image URLs or base64 strings
 * @param {Object} nsfwThresholds - Optional custom thresholds for each category
 * @returns {Promise<Object>} - Returns { isNSFW, results } where isNSFW is true/false/null and results contains detailed analysis
 */
async function checkImageForNSFW(images, nsfwThresholds = defaultNsfwThresholds) {
    // Check if the input is not empty
    if (!images || images.length === 0) {
        console.error('No images provided for NSFW detection');
        return { isNSFW: null, predictionResults: [] };
    }

    // Convert input to array if it's not already
    const imageArray = Array.isArray(images) ? images : [images];

    // Prepare results array
    const predictionResults = [];

    try {
        // Make sure the model is loaded
        if (!nsfwModel) {
            await initializeNSFWModel();
        }

        // Process each image in the array
        for (const image of imageArray) {
            try {
                // Skip empty image strings
                if (!image || (typeof image === "string" && image.trim() === "")) continue;

                // Extract file extension if it's a URL (for diagnostics)
                let fileExtension = '';
                if (image.startsWith('http') || image.startsWith('https')) {
                    const urlParts = image.split('.');
                    if (urlParts.length > 1) {
                        fileExtension = urlParts[urlParts.length - 1].split('?')[0].toLowerCase();
                    }
                }

                // Load the image using our safe function that handles multiple formats
                const tensor = await safeLoadImage(image);

                // Run the NSFW detection directly on the tensor
                const predictions = await nsfwModel.classify(tensor);

                // Clean up the tensor to prevent memory leaks
                tensor.dispose();

                // Store the image and its predictions in results
                const imageResult = {
                    image: image,
                    fileType: fileExtension,
                    predictions: predictions,
                    containsNSFW: false,
                    error: null
                };

                // Check if any category exceeds its threshold
                for (const prediction of predictions) {
                    const { className, probability } = prediction;

                    // Check if this class is in our thresholds object
                    if (className in nsfwThresholds && probability > nsfwThresholds[className]) {
                        console.log(`NSFW content detected: ${className} with probability ${probability}`);
                        imageResult.containsNSFW = true;
                    }
                }

                predictionResults.push(imageResult);
            } catch (imageError) {
                // Individual image errors should not stop the entire process
                console.error(`Error processing specific image: ${image.substring(0, 100)}...`);
                console.error(`Specific error: ${imageError.message}`);

                predictionResults.push({
                    image: image,
                    predictions: [],
                    containsNSFW: null,
                    error: {
                        message: imageError.message,
                        stack: imageError.stack,
                        name: imageError.name
                    }
                });
            }
        }

        // Determine if any image contains NSFW content
        // If some images failed but others were successfully analyzed, we can still get partial results
        const successfulResults = predictionResults.filter(result => result.error === null);
        const hasNsfw = successfulResults.some(result => result.containsNSFW);
        const allFailed = successfulResults.length === 0;

        const isNSFW = allFailed ? null : hasNsfw;

        return {
            isNSFW,
            predictionResults,
            successCount: successfulResults.length,
            failCount: predictionResults.length - successfulResults.length,
            allFailed
        };
    } catch (error) {
        console.error('Fatal error in NSFW detection:', error);
        return {
            isNSFW: null,
            predictionResults,
            error: {
                message: error.message,
                stack: error.stack
            }
        };
    }
}


// MAIN FUNCTION
async function processCharacters() {
    console.log(`\n\nStarting character processing v${scriptVersion}...\n`);

    try {

        // Check Gemini API quota
        const api = 'gemini'
        if (!(await quotaManager.checkQuota(api))) {
            if (API_CONFIG[api].endExecutionOnFail) {
                console.error(`${api} API quota exceeded. Halting execution.`);
                process.exit(0);
            } else if (API_CONFIG[api].skipExecutionOnFail) {
                console.warn(`    ${api} API quota exceeded. Skipping execution.`);	
                return null;
            } else {
                console.warn(`    ${api} API quota exceeded.`);
                return null;
            }
        }

        const characterFolders = await getNewCharacterFolders();
        console.log(`Processing ${CONFIG.MAX_CHARACTERS_PER_RUN} of ${characterFolders.length} characters found to process`);
        const foldersToProcess = characterFolders.slice(0, CONFIG.MAX_CHARACTERS_PER_RUN);

        // Extract existing links from index.json
        const existingLinks = await getLinksFromIndex();

        // Process each folder
        for (const folder of foldersToProcess) {
            // Process the character and get new links
            const newLinks = await processCharacter(folder, existingLinks);

            // Add new links to the existing links array for duplicate checking
            if (newLinks) {
                existingLinks.push(...newLinks);
            }

            // Apply cooldown if processing multiple folders
            if (foldersToProcess.length > 1) {
                await quotaManager.Cooldown();
            }
        }


        printStats();

    } catch (error) {
        console.error("Fatal error during processing:", error);
        process.exit(1);
    }
}

async function processCharacter(folder, existingLinks) {
    console.log('\n\n----------------');
    console.log(`Processing character: ${folder}`);

    try {

        // Read metadata.json
        const metadata = await FileHandler.readJson(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.METADATA_FILE));
        //console.log("    Metadata:", metadata);

        // Create arrays to store and manipulate links
        const processedLinks = [];
        const uniqueMetadata = [];
        const seenLinks = new Set();

        // Keep only unique links
        for (const item of metadata) {
            if (!seenLinks.has(item.link)) {
                seenLinks.add(item.link);
                uniqueMetadata.push(item);
            }
        }

        // Get total items to process
        let totalItems = uniqueMetadata.length;

        //console.log(`    ${totalItems} Unique metadata:`, JSON.stringify(uniqueMetadata));

        // Iterate over unique metadata
        for (const item of uniqueMetadata) {
            try {
                console.log(`-----\n    Processing file: ${item.fileId} with link: ${item.link}`);

                // Check if link or folder is a duplicate
                const { duplicateType, duplicatePath } = await checkDuplicateLinksAndFolder(item, existingLinks, folder);
                // duplicatePath: sfw/2B_and_A2 by f2956d4fbdec4339c178

                // Check if link is duplicate
                if (duplicateType === 'link') {
                    console.log(`    Removing ${item.fileId} from folder ${folder} due to duplicate link.`);
                    await removeDuplicate(folder, duplicatePath, item);
                    totalItems--;
                    stats.duplicate++;
                    continue;
                }

                // Access or download gzfile to extract data to perform more checks
                // Get Gz fileId
                const gzFile = item.fileId;

                // Extract Gz content or download if corrupted / missing
                const { characterData, fileHash } = await extractCharacterData(folder, gzFile, existingLinks);


                // Check if hash is duplicate
                if (characterData === 'duplicate') {
                    console.log(`    Removing ${item.fileId} from folder ${folder} due to duplicate hash.`);
                    await removeDuplicate(folder, null, item, fileHash);
                    totalItems--;
                    stats.duplicate++;
                    continue;
                }

                // Check if folder is duplicate
                if (duplicateType === 'folder') {
                    console.log(`    Found existing folder ${duplicatePath} for ${item.characterName}.`);
                    // Check if is 
                    const duplicateCheck = similarityChecker.compareCharacterWithExisting(characterData, item.authorName, item.authorId, duplicatePath)
                    if (duplicateCheck.isDuplicate && !duplicateCheck.isUpdate) {
                        console.log(`    Removing ${item.fileId} from folder ${folder} due to ${duplicateCheck.overallSimilarity * 100}% similarity.`);
                        await removeDuplicate(folder, duplicatePath, item, fileHash);
                        totalItems--;
                        stats.duplicate++;
                        continue;
                    }
                }

                /* ---------------------------- SIMILARITY CHECK ---------------------------- */
                // Check for forks/updates before processing
                const forkAnalysis = await checkForForkAndUpdate(characterData, item, CONFIG);
                //console.log(`Fork analysis: ${JSON.stringify(forkAnalysis)}`);

                if (forkAnalysis.isExisting && forkAnalysis.type === 'DUPLICATE') {
                    // This is an update to an existing character
                    console.log(`    Removing ${item.fileId} from folder ${folder} due to similarity type: ${forkAnalysis.type}.`);
                    await removeDuplicate(folder, duplicatePath, item, fileHash);
                    totalItems--;
                    stats.duplicate++;
                    continue;
                }

                if (forkAnalysis.isExisting && forkAnalysis.type === 'UPDATE') {
                    // This is an update to an existing character
                    console.log(`Character ${item.characterName} is an UPDATE to existing character. Similarity: ${forkAnalysis.overallSimilarity}.`);
                    stats.updated++;
                }

                // If it's a fork, add that information to the manifest
                if (forkAnalysis.type === 'FORK') {
                    console.log(`Character ${item.characterName} is an FORK of existing character. Similarity: ${forkAnalysis.overallSimilarity}.\nForked character: ${forkAnalysis.forkedFrom}`);
                    stats.forked++;
                }

                // Read capturedMessage.json
                const message = await FileHandler.readJson(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.MESSAGE_FILE));

                const characterName = characterData?.addCharacter?.name || '';
                const userCharacterName = characterData?.userCharacter?.name || '';
                const roleInstruction = characterData?.addCharacter?.roleInstruction || '';
                const reminder = characterData?.addCharacter?.reminderMessage || '';
                const userRole = characterData?.userCharacter?.roleInstruction || '';
                const categories = await FileHandler.readJson(FILE_OPS.CATEGORIES_FILE);
                const backgroundUrl = characterData?.addCharacter?.scene?.background?.url || "";
                const avatarUrl = characterData?.addCharacter?.avatar?.url || "";

                //const aiAnalysis = await analyzeCharacterWithAI(characterData);
                const aiAnalysis = await classifyCharacter(roleInstruction, reminder, userRole, characterName, userCharacterName, categories, folder, avatarUrl ? 'default' : 'stableDiffusion')
                if (!aiAnalysis) {
                    errMsg = `Variable aiAnalysis is blank. Data is needed to continue.\nSkipping character processing.`;
                    console.error(errMsg);
                    stats.errors.push({ folder, error: errMsg });
                    continue;
                }

                // Variable to check character image condition
                let finalImage, finalBackground;

                // Check if the avatar URL is empty
                if (!avatarUrl) {
                    console.log("    Missing avatar. Trying find one inside folder or generating a new one.");

                    // Try to find an avatar file in the folder
                    const avatarFiles = glob(path.join(CONFIG.SOURCE_PATH, folder, 'avatar.*'));
                    if (avatarFiles.length > 0) {
                        console.log("    Found local avatar file:", avatarFiles[0]);
                        try {
                            // Read the image file and convert to base64
                            const imageBuffer = await fs.readFile(avatarFiles[0]);
                            const mimeType = path.extname(avatarFiles[0]).substring(1);
                            const tmpImg = `data:image/${mimeType};base64,${imageBuffer.toString('base64')}`;

                            // Upload the image
                            finalImage = await uploadImage(tmpImg, folder);
                        } catch (error) {
                            console.error("    Error processing local avatar:", error, ". Skipping character.");
                            stats.missingImage++;
                            stats.errors.push({ folder, error: errMsg });
                            continue;
                        }
                    } else {
                        // Try to generate a new image
                        const generatedImage = await generateImage(aiAnalysis);

                        // Upload the generated image
                        if (generatedImage) {
                            finalImage = await uploadImage(generatedImage, folder);
                        } else {
                            errMsg = '    Image was not generated or found locally. Skipping character.'
                            FileHandler.writeJson(path.join(CONFIG.SOURCE_PATH, folder, '_missingAvatar.json'), aiAnalysis);
                            console.error(errMsg)
                            stats.missingImage++;
                            stats.errors.push({ folder, error: errMsg });
                            continue;
                        }
                    }
                }
                // Check if the avatar or background image URL is a Base64 image
                else if (avatarUrl.startsWith("data:image") || backgroundUrl.startsWith("data:image")) {

                    // If the avatar is a Base64 image, upload it to the api
                    if (avatarUrl.startsWith("data:image")) {
                        console.log("    Avatar is a Base64 image. Uploading it.");
                        finalImage = await uploadImage(avatarUrl, folder);
                    }

                    // If the background is a Base64 image, upload it to the api
                    if (backgroundUrl.startsWith("data:image")) {
                        console.log("    Background is a Base64 image. Uploading to freeimage.");
                        finalBackground = await uploadImage(backgroundUrl, folder);
                    }
                } else {
                    finalImage = avatarUrl;
                    finalBackground = backgroundUrl;
                }

                // Check if the final image is missing and skip the character if it is
                if (!finalImage) {
                    console.error("    Missing avatar image. Skipping character.");
                    errMsg = `Missing avatar image. Skipping character.`;
                    stats.missingImage++;
                    stats.errors.push({ folder, error: errMsg });
                    continue;
                }

                // Check for NSFW content in the images
                const { isNSFW, predictionResults } = await checkImageForNSFW([avatarUrl, backgroundUrl]); // Use the original images to avoid having to download them again
                if (isNSFW === null) {
                    console.error("    NSFW detection failed. Skipping character.");
                    errMsg = `NSFW detection failed. Skipping character.`;
                    stats.errors.push({ folder, error: errMsg });
                    continue;
                } else if (isNSFW) {
                    // Find and update the rating property regardless of letter case
                    const ratingKey = Object.keys(aiAnalysis).find(key => key.toLowerCase() === 'rating');
                    if (ratingKey) {
                        aiAnalysis[ratingKey] = 'nsfw';
                    }

                    // Find and update the Rating category if it exists
                    if (aiAnalysis.categories) {
                        const categoryKey = Object.keys(aiAnalysis.categories).find(key => key.toLowerCase() === 'rating');
                        if (categoryKey) {
                            aiAnalysis.categories[categoryKey] = 'nsfw';
                        }
                    }
                }

                // Determine destination path based on aiAnalysis and NSFW image analysis
                const destinationPath = determineDestinationPath(aiAnalysis, isNSFW);

                // Create character structure in destination
                await createCharacterStructure(folder, item, message, characterData, aiAnalysis, destinationPath, finalImage, finalBackground, fileHash, forkAnalysis);

                /* ------------------------------- WRITE FILES ------------------------------ */

                //Copy capturedMessage.json
                await fs.copyFile(
                    path.join(CONFIG.SOURCE_PATH, folder, CONFIG.MESSAGE_FILE),
                    path.join(destinationPath, folder, CONFIG.MESSAGE_FILE)
                );

                // Write metadata.json
                await FileHandler.writeJson(
                    path.join(destinationPath, folder, CONFIG.METADATA_FILE),
                    [{
                        folderName: folder,
                        characterName: item.characterName || "Unnamed",
                        characterName_Sanitized: item.characterName_Sanitized ? item.characterName_Sanitized : item.characterName ? sanitizeFileName(item.characterName) : "Unnamed",
                        fileId: item.fileId,
                        link: item.link,
                        shareLinkFileHash: fileHash || item.shareLinkFileHash || "",
                        authorName: item.authorName || "Anonymous",
                        authorId: item.authorId || "Anonymous",
                    }]
                );

                // Write aiAnalysis.json
                FileHandler.writeJson(path.join(destinationPath, folder, 'aiAnalysis.json'), aiAnalysis);

                // Write similarityAnalysis.json
                FileHandler.writeJson(path.join(destinationPath, folder, 'similarityAnalysis.json'), forkAnalysis);

                // Write nsfwjsPredictions.json
                FileHandler.writeJson(path.join(destinationPath, folder, 'nsfwjsPredictions.json'), predictionResults);

                /* ---------------------------- FINISH PROCESSING --------------------------- */

                updateStats(aiAnalysis.rating);

                // If everything went well, add to processed links
                processedLinks.push({
                    path: folder,
                    name: item.characterName || "",
                    shareUrl: item.link || "",
                    authorId: item.authorId || "",
                    shareLinkFileHash: item.shareLinkFileHash || ""
                });

                // Take the processed item from the total
                totalItems--;

            } catch (error) {
                console.error(`Error processing item ${JSON.stringify(item)} of folder ${folder}:`, error);
                stats.errors.push({ folder, error: error.message });
                continue;
            }

        }

        // Only remove the folder after processing if there are no more items to process
        if (totalItems === 0) {
            // Remove the folder from source after 
            console.log(`    Removing folder ${folder} from source after processing`);
            await FileHandler.removeDirectory(path.join(CONFIG.SOURCE_PATH, folder));
        }

        // Return all processed links
        console.log(`Added items: ${processedLinks.length} of ${uniqueMetadata.length}. Unprocessed items: ${totalItems}`);
        return processedLinks;

    } catch (error) {
        console.error(` Error processing character in folder ${folder}:`, error);
        stats.errors.push({ folder, error: error.message });
    }
}

/* -------------------------------------------------------------------------- */
/*                             AUXILIARY FUNCTIONS                            */
/* -------------------------------------------------------------------------- */

/**
 * Sanitizes a string while preserving readable characters
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string safe for filesystem use
 */
function sanitizeString(str) {
    if (!str) return 'unnamed';

    return str
        .normalize('NFKD')                          // Normalize Unicode to decompose accented characters
        .replace(/[\u0300-\u036f]/g, '')              // Remove diacritical marks (accents)
        .replace(/[\p{C}\p{Zl}\p{Zp}\p{Cf}]+/gu, '')  // Remove control characters, invisible characters, and formatting characters
        .replace(/[\/\\:*?"<>|#@!%^&=`[\]{}$;,+]+/g, '') // Remove problematic characters for OS, URLs, and databases
        .replace(/\s{2,}/g, ' ') // Replace multiple spaces with a single space
        .replace(/\s+/g, '_')                     // Replace all spaces with underscores
        .replace(/[^a-zA-Z0-9\p{L}\p{M}\p{N}_-]/gu, '') // Allow only safe characters
        .replace(/_{2,}/g, '_')                      // Replace multiple underscores with a single one
        .replace(/^[-_ ]+|[-_ ]+$/g, '')             // Trim leading/trailing underscores, dashes, and spaces
        .trim();                                     // Trim spaces at the beginning and end
}

function sanitizeFileName(fileName) {
    if (!fileName) {
        console.error('Error: File name is empty or null.');
        return 'unnamed';
    }

    // Split the file name into name and extension using the last '.' as separator
    const lastDotIndex = fileName.lastIndexOf('.');

    // If no dot is found, treat the whole filename as the name with no extension
    const name = lastDotIndex === -1 ? fileName : fileName.slice(0, lastDotIndex);
    const extension = lastDotIndex === -1 ? '' : fileName.slice(lastDotIndex);  // Keep the dot with the extension

    // Sanitize the name part
    const sanitizedName = sanitizeString(name);

    // If the sanitized name is empty, log an error and return a default value
    if (!sanitizedName) {
        console.error('Error: Sanitized file name is empty.');
        return 'unnamed' + extension;  // Return default name with the original extension
    }

    // Recombine sanitized name with the extension
    return `${sanitizedName}${extension}`;
}


function bumpVersion(version) {
    const parts = version.split('.').map(num => parseInt(num, 10));
    if (parts.length !== 3) return '1.0.0'; // Fallback if version is invalid
    parts[2]++; // Increment patch version
    return parts.join('.');
}

async function getLinksFromIndex() {
    try {
        // Read the JSON file using the 
        const indexPath = path.join(CONFIG.OUTPUT_PATH, 'index.json');
        const indexData = await FileHandler.readJson(indexPath);

        // Create an array to store all the links
        const extractedLinks = [];
        let linkInfo = {};

        // Loop through each entry in the index file
        for (const entry of indexData) {
            if (entry.manifest) {
                // Populate the object with all required information
                linkInfo = {
                    path: entry.path || "",                                    // Character path
                    name: entry.manifest.name || "",                       // Character name
                    shareUrl: entry.manifest.shareUrl || "",               // Share URL
                    authorId: entry.manifest.authorId || "",               // Author ID
                    shareLinkFileHash: entry.manifest.shareLinkFileHash || "" // File hash
                }
            };

            extractedLinks.push(linkInfo);
        }

        return extractedLinks;

    } catch (error) {
        console.error('Error reading or processing index.json:', error);
        throw error;
    }
}

/**
 * Resizes a base64 image to a specified width while maintaining aspect ratio
 * @param {string} dataURL - The base64 data URL of the image
 * @param {number} maxWidth - Maximum width in pixels (default: 512)
 * @param {number} maxHeight - Maximum height in pixels (default: 768)
 * @param {string} format - Output format (default: 'webp')
 * @param {number} quality - Output quality (default: 80)
 * @returns {Promise<Object>} - Object with optimized image as a base64 data URL and format
 */
async function optimizeImage(dataURL, maxWidth = 512, maxHeight = 768, format = 'webp', quality = 80) {
    // Create a promise wrapper around the image optimization process
    return new Promise((resolve, reject) => {
        try {
            // Load the image from the data URL
            loadImage(dataURL).then(img => {
                // Calculate new dimensions while maintaining aspect ratio
                let width = img.width;
                let height = img.height;

                // Scale down if image exceeds maximum dimensions
                if (width > maxWidth || height > maxHeight) {
                    const ratioWidth = maxWidth / width;
                    const ratioHeight = maxHeight / height;
                    const ratio = Math.min(ratioWidth, ratioHeight);

                    width = Math.floor(width * ratio);
                    height = Math.floor(height * ratio);
                }

                // Create canvas with the new dimensions
                const canvas = createCanvas(width, height);
                const ctx = canvas.getContext('2d');

                // Draw the image on the canvas with the new dimensions
                ctx.drawImage(img, 0, 0, width, height);

                // Convert to specified format with quality setting
                // For WebP, explicitly set the quality parameter
                const optimizedDataURL = canvas.toDataURL(`image/${format}`, quality / 100);

                // Calculate size of the optimized image in KB
                const base64Data = optimizedDataURL.split('base64,')[1];
                const sizeInBytes = Buffer.from(base64Data, 'base64').length;
                const sizeInKB = Math.round(sizeInBytes / 1024);

                //console.log(`Optimized image: ${width}x${height}, ${format}, ${quality}% quality, ${sizeInKB}KB`);

                resolve({
                    dataURL: optimizedDataURL,
                    format: format,
                    width: width,
                    height: height,
                    sizeInKB: sizeInKB
                });
            }).catch(err => reject(err));
        } catch (error) {
            reject(error);
        }
    });
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
    console.log(`Updated: ${stats.updated}`);
    console.log(`Forked: ${stats.forked}`);
    console.log(`Missing Image: ${stats.missingImage}`);
    console.log(`Errors: ${stats.errors.length}`);

    if (stats.errors.length > 0) {
        console.log('\n\nErrors encountered:');

        // Group errors by error message
        const errorGroups = stats.errors.reduce((groups, error) => {
            const message = error.error;
            if (!groups[message]) {
                groups[message] = [];
            }
            groups[message].push(error.folder);
            return groups;
        }, {});

        // Print each error type with its folders
        for (const [errorMessage, folders] of Object.entries(errorGroups)) {
            console.log(`\n${folders.length} Folders affected by error: ${errorMessage}`);
            console.log('\n');
            folders.forEach(folder => console.log(`- ${folder}`));
            console.log('\n');
        }
    }
}

/* -------------------------------------------------------------------------- */
/*                               INITIALIZATION                               */
/* -------------------------------------------------------------------------- */

const quotaManager = new QuotaManager();
const similarityChecker = new CharacterSimilarityChecker();
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