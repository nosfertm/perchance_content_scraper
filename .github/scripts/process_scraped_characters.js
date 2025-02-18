// API Configuration and quotas
const API_CONFIG = {
    gemini: {
        token: 'your-gemini-token',
        rateLimit: 60,  // Calls per minute
        maxCalls: 1000, // Maximum calls per day
        maxRetries: 3,  // Maximum retry attempts
        timeBetweenRetries: 1000, // Time in ms between retries
        endExecutionOnFail: true  // Whether to stop execution if API fails
    },
    pigimage: {
        token: 'your-pigimage-token',
        rateLimit: 30,
        maxCalls: 500,
        maxRetries: 3,
        timeBetweenRetries: 2000,
        endExecutionOnFail: false
    },
    freeimage: {
        token: 'your-freeimage-token',
        rateLimit: 20,
        maxCalls: 200,
        maxRetries: 3,
        timeBetweenRetries: 2000,
        endExecutionOnFail: false
    }
};

// File operations configuration
const FILE_OPS = {
    QUOTA_FILE: 'api_quotas.json',
    ENCODING: 'utf8'
};

// Configuration variables
const CONFIG = {
    // Paths
    BASE_PATH: "ai-character-chat/characters",
    SOURCE_PATH: "ai-character-char/characters/scrape/perchance_comments",
    PATHS: {
        VALIDATED_SFW: "sfw",
        VALIDATED_NSFW: "nsfw",
        MANUAL_REVIEW: "Manual Review",
        QUARANTINE: "Quarantine",
        DISCARDED_INVALID: "Discarded/Invalid",
        DISCARDED_DUPLICATE: "Discarded/Duplicated"
    },

    // Processing limits
    MAX_CHARACTERS_PER_RUN: 4,  // Maximum number of characters to process in one run

    // File patterns
    METADATA_FILE: "metadata.json",
    MESSAGE_FILE: "capturedMessage.json"
}

// Import required modules
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import { gzip, gunzip } from 'zlib';
import { parse } from 'url';
import querystring from 'querystring';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);


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
            console.error(`Error reading file ${filePath}:`, error);
            throw error;
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
            console.error(`Error reading JSON file ${filePath}:`, error);
            throw error;
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
        } catch {
            this.quotas = Object.keys(API_CONFIG).reduce((acc, api) => {
                acc[api] = { dailyCalls: 0, lastReset: new Date().toISOString() };
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

        return this.quotas[apiName].dailyCalls < API_CONFIG[apiName].maxCalls;
    }

    /**
     * Increment API call count
     * @param {string} apiName - Name of the API
     */
    async incrementQuota(apiName) {
        this.quotas[apiName].dailyCalls++;
        await this.saveQuotas();
    }
}

/**
 * Check if character already exists in output directory
 * @param {string} folder - Character folder name
 * @returns {Promise<boolean>} - Whether character exists
 */
async function checkDuplicateCharacter(folder) {
    try {
        const possiblePaths = [
            CONFIG.PATHS.VALIDATED_SFW,
            CONFIG.PATHS.VALIDATED_NSFW,
            CONFIG.PATHS.MANUAL_REVIEW
        ];

        for (const path of possiblePaths) {
            const fullPath = path.join(CONFIG.BASE_PATH, path, folder);
            try {
                await fs.access(fullPath);
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

//TODO - Write this function uploadImage
async function uploadImage(generatedImage) {
    console.lod("TODO - Write this function uploadImage")
}

//TODO - Write this function generateImage
async function generateImage(characterData) {
    console.lod("TODO - Write this function generateImage")
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

// Update processCharacter function to include new checks
async function processCharacter(folder) {
    console.log(`Processing character: ${folder}`);

    try {
        // Read metadata.json
        const metadata = await FileHandler.readJson(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.METADATA_FILE));

        // Check for duplicate - TODO FIX TO DEAL WITH CHARACTER FOLDER
        const isDuplicate = await checkDuplicateCharacter(folder);
        if (isDuplicate) {
            await handleDuplicate(folder);
            return;
        }

        // Initialize QuotaManager
        const quotaManager = new QuotaManager();
        await quotaManager.init();

        // Check Gemini API quota
        if (!(await quotaManager.checkQuota('gemini'))) {
            // TODO exit based on config
            console.log('Gemini API quota exceeded. Halting execution.');
            process.exit(0);
        } // TODO - Incluir else e colocar a função analyzeCharacterWithAI dentro do else?

        // TODO (CLAUDE) - Check if file fileID exist, if it doesn't download it (create a mock function for download)
        gzFile = metadata.fileId;

        const characterData = await extractCharacterData(folder, metadata.fileId);
        const aiAnalysis = await analyzeCharacterWithAI(characterData);
        await quotaManager.incrementQuota('gemini'); // TODO - Mover pra dentro de analyzeCharacterWithAI incrementando baseado no sucesso.

        // Check if character needs image generation
        if (!characterData.avatar?.url) { // TODO - Check if content is base64, if so, upload it to freeimage
            if (!(await quotaManager.checkQuota('pigimage'))) { // Check for quota
                console.log('PigImage API quota exceeded. Skipping image generation.');
            } else {
                const generatedImage = await generateImage(characterData);
                await quotaManager.incrementQuota('pigimage');

                if (!(await quotaManager.checkQuota('freeimage'))) {    // Check for quota
                    // TODO Save image locally
                    console.log('FreeImage API quota exceeded. Skipping image upload.');
                } else {
                    const imageUrl = await uploadImage(generatedImage);
                    characterData.avatar = { url: imageUrl };
                    await quotaManager.incrementQuota('freeimage');
                }
            }
        }

        const destinationPath = determineDestinationPath(aiAnalysis);
        await createCharacterStructure(folder, metadata, characterData, aiAnalysis, destinationPath);
        await FileHandler.removeDirectory(path.join(CONFIG.SOURCE_PATH, folder));
        updateStats(aiAnalysis.rating);

    } catch (error) {
        console.error(`Error processing character in folder ${folder}:`, error);
        stats.errors.push({ folder, error: error.message });
    }
}

/**
 * Placeholder function for AI analysis
 * @param {object} characterData - Character data from gz file
 */
async function analyzeCharacterWithAI(characterData) {
    // TODO: Implement actual AI analysis
    return {
        rating: 'sfw',
        categories: ['cat1', 'cat2'],
        description: 'A placeholder description',
        readmeContent: 'A placeholder README content',
        needsManualReview: false,
        charState: 'valid'  // valid, quarantine, invalid
    };
}

/**
 * Extract character data from gz file
 * @param {string} folder - Character folder name
 * @param {string} fileName - File name
 */
async function extractCharacterData(folder, fileName) {
    const gzPath = path.join(CONFIG.SOURCE_PATH, folder, fileName);
    const gzBuffer = await fs.readFile(gzPath);
    const unzipped = await util.promisify(gunzip)(gzBuffer);
    return JSON.parse(unzipped.toString());
}

/**
 * Determine destination path based on AI analysis
 * @param {object} aiAnalysis - Analysis results from AI
 */
function determineDestinationPath(aiAnalysis) {
    if (aiAnalysis.needsManualReview) {
        return CONFIG.PATHS.MANUAL_REVIEW;
    }

    return aiAnalysis.rating === 'sfw'
        ? CONFIG.PATHS.VALIDATED_SFW
        : CONFIG.PATHS.VALIDATED_NSFW;

    // TODO (CLAUDE) - Treat AI response for quarantine, broken and troll characters accordingly
}


/**
 * Create character structure in destination
 * @param {string} folder - Original folder name
 * @param {object} metadata - Metadata from source
 * @param {object} characterData - Character data from gz file
 * @param {object} aiAnalysis - AI analysis results
 * @param {string} destinationPath - Destination path
 */
async function createCharacterStructure(folder, metadata, characterData, aiAnalysis, destinationPath) {
    // Create manifest
    const manifest = createManifest(metadata, characterData, aiAnalysis);

    // Create changelog
    const changelog = createChangelog();

    // Prepare files to commit
    const files = {
        'manifest.json': JSON.stringify(manifest, null, 2),
        'changelog.json': JSON.stringify(changelog, null, 2),
        'README.md': aiAnalysis.readmeContent,
        'character.gz': await util.promisify(gzip)(JSON.stringify(characterData)) //TODO - Change name to folderName.gz
    };

    // Write files to destination // TODO - fix all fs. uses fs.mkdir/fs.writeFile
    const destFolder = path.join(CONFIG.BASE_PATH, destinationPath, folder);
    await fs.mkdir(destFolder, { recursive: true });

    for (const [filename, content] of Object.entries(files)) {
        await fs.writeFile(path.join(destFolder, filename), content);
    }

    // Update index.json
    await updateCharacterIndex(destFolder, manifest);
}

/**
 * Create manifest for character
 * @param {object} metadata - Character metadata
 * @param {object} characterData - Character data
 * @param {object} aiAnalysis - AI analysis results
 */
function createManifest(metadata, characterData, aiAnalysis) {
    return {
        name: characterData.name,
        description: aiAnalysis.description,
        author: metadata.userNickname || metadata.username,
        authorId: metadata.userId,
        source: 'SCRAPER',
        imageUrl: characterData.avatar?.url || '',
        shareUrl: 'LINK', //TODO ADD LINK
        shapeShifter_Pulls: 0,
        galleryChat_Clicks: 0,
        galleryDownload_Clicks: 0,
        groupSettings: {
            requires: [],
            recommends: []
        },
        features: {
            customCode: [],
            assets: []
        },
        categories: aiAnalysis.categories
    };
}

/**
 * Create changelog for character
 */
function createChangelog() {
    const now = new Date().toISOString();
    return {
        currentVersion: '1.0.0',
        created: now,
        lastUpdated: now,
        history: [
            {
                version: '1.0.0',
                date: now,
                type: 'initial',
                changes: ['Initial release']
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
    const indexPath = path.join(CONFIG.BASE_PATH, 'index.json');

    try {
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

// Add random processing order
function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

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
        console.log("Found files/folders:", filter);

        return filter;

    } catch (err) {
        console.error(`Error reading directory ${CONFIG.SOURCE_PATH}:`, err.message);
        throw err;
    }
}

// Update main function to use shuffled array
async function processCharacters() {
    console.log("Starting character processing...");

    try {
        const characterFolders = await getCharacterFolders();
        console.log(`Found ${characterFolders.length} characters to process`);

        // Shuffle folders and limit to MAX_CHARACTERS_PER_RUN
        const shuffledFolders = shuffleArray([...characterFolders]);
        const foldersToProcess = shuffledFolders.slice(0, CONFIG.MAX_CHARACTERS_PER_RUN);

        for (const folder of foldersToProcess) {
            await processCharacter(folder);
        }

        printStats();

    } catch (error) {
        console.error("Fatal error during processing:", error);
        process.exit(1);
    }
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
    console.log('\nProcessing Summary:');
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

// Start processing with error handling
processCharacters().catch(error => {
    console.error("Fatal error:", error);
    process.exit(1);
});