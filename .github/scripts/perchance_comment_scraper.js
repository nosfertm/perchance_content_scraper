// perchance_comment_scraper.js
// Scrapes the comment section on perchance and saves the character files
// Code heavily inspired on VioneT20 code.

/* -------------------------------------------------------------------------- */
/*                                   CONFIG                                   */
/* -------------------------------------------------------------------------- */

const scriptVersion = '4.3';

const CONFIG = {
    channels: ["chat", "chill", "rp", "spam", "vent", "share", "botshare", "makeabot", "nsfw", "channel-hub"],
    maxMessagesPerChannel: 5200,
    baseApiUrl: "https://comments-plugin.perchance.org/api/getMessages",
    timestampFile: "last_processed.json",
    capturedCharactersFile: "capturedCharacters.json",
    targetBranch: process.env.TARGET_BRANCH || "main",
    outputDir: path.join("scrape", "perchance_comments", "Raw"),
    owner: process.env.GITHUB_REPOSITORY?.split('/')[0],
    repo: process.env.GITHUB_REPOSITORY?.split('/')[1]
};

const LINK_PATTERN = /perchance\.org\/(.+?)\?data=([^~]+)~([^?]+\.gz)/;
const fullProcessing = process.env.FULL_PROCESSING === 'true';

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

import { Octokit } from '@octokit/rest';
//import fetch from 'node-fetch';
import path, { dirname } from 'path';
import crypto from 'crypto';
import { promises as fs } from 'fs';


const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

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

/* -------------------------------------------------------------------------- */
/*                                FILE HANDLING                               */
/* -------------------------------------------------------------------------- */

async function getGithubFile(path) {
    try {
        const response = await octokit.repos.getContent({
            owner: CONFIG.owner,
            repo: CONFIG.repo,
            path: path,
            ref: CONFIG.targetBranch
        });

        const content = Buffer.from(response.data.content, 'base64').toString();
        return JSON.parse(content);
    } catch (error) {
        if (error.status === 404) {
            console.log(`   File ${path} not found, creating new...`);
            return null;
        }
        throw error;
    }
}

/**
 * Creates or updates a file in GitHub repository with retry logic
 * @param {string} filePath - Path to file
 * @param {string} content - File content
 * @param {string} message - Commit message
 * @param {boolean} append - Whether to append content to existing file (default: false)
 * @param {boolean} log - Whether to log success messages (default: true)
 * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
 */
async function createOrUpdateFile(filePath, content, message, append = false, log = true, maxRetries = 3) {
    let retryCount = 0;
    let lastError = null;
    
    // Exponential backoff delay calculation
    const getBackoffDelay = (retryCount) => Math.min(1000 * Math.pow(2, retryCount), 10000);
    
    while (retryCount <= maxRetries) {
        try {
            // Check if file exists and get its content if in append mode
            let sha;
            let existingContent;
            
            try {
                // Get the latest version of the file
                const file = await octokit.repos.getContent({
                    owner: CONFIG.owner,
                    repo: CONFIG.repo,
                    path: filePath,
                    ref: CONFIG.targetBranch
                });
                sha = file.data.sha;

                // If append mode and it's a .json file, get existing content
                if (append && path.extname(filePath) === '.json') {
                    existingContent = Buffer.from(file.data.content, 'base64').toString('utf8');
                }
            } catch (error) {
                if (error.status !== 404) throw error;
                // If file doesn't exist, we'll create it (no SHA needed)
            }

            // Handle content merging for JSON files in append mode
            let contentToUpload = content;
            if (append && existingContent && path.extname(filePath) === '.json') {
                // Parse existing and new content
                const existingData = JSON.parse(existingContent);
                const newData = JSON.parse(content);

                // Ensure both are arrays
                const existingArray = Array.isArray(existingData) ? existingData : [existingData];
                const newArray = Array.isArray(newData) ? newData : [newData];

                // Combine arrays and convert back to string
                contentToUpload = JSON.stringify([...existingArray, ...newArray], null, 2);
            }

            // Convert final content to base64
            const contentBuffer = Buffer.isBuffer(contentToUpload) ? contentToUpload : Buffer.from(contentToUpload);
            const contentBase64 = contentBuffer.toString('base64');

            // Create or update file
            await octokit.repos.createOrUpdateFileContents({
                owner: CONFIG.owner,
                repo: CONFIG.repo,
                path: filePath,
                message: message,
                content: contentBase64,
                branch: CONFIG.targetBranch,
                sha: sha
            });

            if (log) {
                const action = sha ? (append ? 'appended to' : 'updated') : 'created';
                console.log(`           Successfully ${action} ${filePath}`);
            }
            
            // If we get here, the operation was successful
            return;
            
        } catch (error) {
            lastError = error;
            
            // If it's a 409 conflict error, retry with exponential backoff
            if (error.status === 409) {
                retryCount++;
                
                if (retryCount <= maxRetries) {
                    const delay = getBackoffDelay(retryCount);
                    console.log(`           File conflict detected for ${filePath}. Retrying in ${delay/1000} seconds... (Attempt ${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
            } else {
                // For other errors, throw immediately
                console.error(`Error creating/updating file ${filePath}:`, error);
                throw error;
            }
        }
    }
    
    // If we've exhausted retries, throw the last error
    console.error(`Failed to create/update file ${filePath} after ${maxRetries} attempts:`, lastError);
    throw lastError;
}

/* -------------------------------------------------------------------------- */
/*                             DUPLICATE HANDLING                             */
/* -------------------------------------------------------------------------- */

async function getLinksFromIndex() {
    try {
        // Read the JSON file using the 
        const indexPath = path.join("ai-character-chat", "characters", 'index.json');
        let indexData;

        try {
            const content = await fs.readFile(indexPath, 'utf-8');
            indexData = JSON.parse(content);
        } catch (error) {
            console.error(`Error in readJson for file ${indexPath}:`, error);
            throw error;
        }

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
 * Calculate the hash of a given file buffer.
 * @param {Buffer} fileBuffer - The file data as a Buffer.
 * @param {string} algorithm - The hash algorithm (default: 'sha256').
 * @returns {Promise<string>} The computed hash as a hexadecimal string.
 */
async function calculateFileHash(fileBuffer, algorithm = 'sha256') {
    try {
        // Create a hash instance
        const hash = crypto.createHash(algorithm);

        // Update hash with the file data
        hash.update(fileBuffer);

        // Return the final hash as a hex string
        return hash.digest('hex');
    } catch (error) {
        console.error('Error calculating file hash:', error.message);
        throw error;
    }
}


// Function to check for duplicate links and update counters
function checkForDuplicateLinks(characterLinks, existingLinks) {
    // Array to store unique links
    const uniqueLinks = [];
    // Counter for duplicate links found
    let duplicateCount = 0;

    // Check each character link against existing links
    for (const charInfo of characterLinks) {
        // Get file hash from the link (if exists)
        const fileHash = charInfo.fileId || "";

        // Check if link exists in existingLinks
        const isDuplicate = existingLinks.some(existing =>
            (existing.shareUrl === charInfo.link) ||
            (existing.shareLinkFileHash === fileHash)
        );

        if (isDuplicate) {
            // Increment duplicate counter
            console.log(`       Duplicate link found for ${charInfo.character}: ${charInfo.link}.`);
            duplicateCount++;
        } else {
            // Add to unique links array if not a duplicate
            uniqueLinks.push(charInfo);
        }
    }

    return {
        uniqueLinks,      // Links that aren't duplicates
        duplicateCount    // Number of duplicates found
    };
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
/*                               CHARACTER FILES                              */
/* -------------------------------------------------------------------------- */

/**
 * Extracts character links from a message.
 * If a character link is found and the message contains "NOSCRAPE", that character is ignored.
 * @param {string} message - The message text containing links.
 * @returns {Object} Object containing links array and ignored status
 */
function extractCharacterLinks(message) {

    // Add a space after each .gz to separate concatenated links (ex: '...43eac53.gzhttps:\\...' > '...43eac53.gz https:\\...')
    message = message.replace(/\.gz/g, '.gz ');

    // Safe URI decoding function
    const safeDecode = (str) => {
        try {
            return decodeURIComponent(str).trim();
        } catch (e) {
            const sntStr = sanitizeString(str);
            console.warn(`  Decoding failed for: ${str}, Sanitized result: ${sntStr}`);
            return sntStr; // Use sanitized fallback
        }
    };

    // Validate if the link is in a correct format
    const isValidLink = (link) => {
        // Check for duplicate occurrences of key URL components
        const keyComponents = [
            'https://',
            'perchance.org',
            'ai-character-chat',
            'data='
        ];

        // Check each component for multiple occurrences
        for (const component of keyComponents) {
            const count = (link.match(new RegExp(component, 'g')) || []).length;
            if (count > 1) {
                console.warn(`  Skipping URL: multiple occurrences of ${component} found.\n${link}`);
                return false;
            }
        }

        // If we got here, check the basic pattern
        const linkPattern = /perchance\.org\/ai-character-chat\?data=([^~]+)~([^?]+\.gz)/;
        return linkPattern.test(link);
    };

    // Extract all potential character links
    const links = message
        .split(/\s+/) // Split the message by spaces
        .filter(a => a.includes('data=') && a.includes('~')) // Filter out parts that don't contain 'data=' and '~'
        .map(a => {
            // First, check if the link itself is valid before trying to decode
            if (!isValidLink(a)) {
                return null; // Skip invalid links
            }

            // Extracts the link using the updated pattern
            const match = a.match(LINK_PATTERN);
            if (!match) return null; // If there's no match, ignore this part

            const fullLink = match[0]; // Full matched link
            const character = match[2]; // Extracts the character name from the match
            const fileId = match[3]; // Extracts the file ID from the match

            return {
                character: safeDecode(character), // Decode character name safely
                fileId: fileId, // File ID
                link: `https://${fullLink.trim()}` // Full HTTPS link
            };
        })
        .filter(Boolean); // Removes null values from the array

    // Remove duplicates
    const uniqueLinks = [...new Set(links.map(JSON.stringify))].map(JSON.parse);

    // Only check for NOSCRAPE if we actually found character links
    if (uniqueLinks.length > 0 && message.toLowerCase().includes('noscrape')) {
        // Log each character being ignored
        uniqueLinks.forEach(link => {
            console.log(`       Ignoring character: ${link.character}`);
        });
        return { links: [], ignored: true };
    }

    return {
        links: uniqueLinks,
        ignored: false
    };
}

/**
 * Downloads file from URL and returns it as a Buffer
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} File content as Buffer
 */
async function downloadFile(url) {
    try {
        const download_url = `https://user-uploads.perchance.org/file/${url}`
        console.log(`           Downloading: ${download_url}`);
        const response = await fetch(download_url);

        // Check if download was successful
        if (!response.ok) {
            throw new Error(`Download failed: ${response.status}`);
        }

        // Get the raw buffer
        const fileData = await response.arrayBuffer();
        return Buffer.from(fileData);

    } catch (error) {
        console.error('Failed to download file:', error.message);
        throw error;
    }
}

// Function to create metadata file content
async function createMetadata(characterInfo, message, fileId, charName, folderName, fileHash) {
    try {
        // Create metadata wrapped in an array for future extensibility
        return [{
            folderName: folderName,
            characterName: characterInfo.character,
            characterName_Sanitized: charName,
            fileId: fileId,
            link: characterInfo.link,
            shareLinkFileHash: fileHash || '',
            authorName: message.username || message.userNickname || message.publicId || 'Anonymous',
            authorId: message.publicId || 'Unknown'
        }];
    } catch (error) {
        console.error('Error creating metadata:', error);
        throw error;
    }
}

/**
 * Saves character data and returns information needed for metadata
 * @param {Object} characterInfo - Character information
 * @param {Object} message - Original message
 * @returns {Object} Directory and character information for metadata
 */
async function saveCharacterData(characterInfo, message, existingLinks) {
    console.log("\n");
    console.log("       --------------------");
    console.log(`       Processing character!`);

    // Object to store all files that need to be created/updated
    const filesToCreate = {};

    try {
        // Sanitize character and author names for safe filesystem usage
        const charName = sanitizeString(characterInfo.character) || 'Unnamed';
        console.log(`           Character's name: ${charName}`);

        const authorName = sanitizeString(message.username || message.userNickname || message.publicId || 'Anonymous');
        console.log(`           Author's name: ${authorName}`);

        // Create directory path using sanitized names
        const folderName = path.join(`${charName} by ${authorName}`);
        const dirName = path.join(CONFIG.outputDir, folderName);
        console.log(`           Path: ${dirName}`);

        const fileId = sanitizeFileName(characterInfo.fileId);
        console.log(`           fileId: ${fileId}`);

        try {

            // Download and save character file
            const fileBuffer = await downloadFile(characterInfo.fileId);

            // Calculate file hash
            const fileHash = await calculateFileHash(fileBuffer);

            if (checkForDuplicateHash(existingLinks, fileHash)) {
                console.log(`           Duplicate file hash found for: ${charName}`);
                return null;
            }

            filesToCreate[`${dirName}/${fileId}`] = {
                content: fileBuffer,
                commitMessage: `Add share file for: ${charName}`
            };

            // Create a json to save the original message
            filesToCreate[`${dirName}/capturedMessage.json`] = {
                content: JSON.stringify({ ...message }, null, 2),
                commitMessage: `Add capturedMessage for: ${charName}`
            };

            // Create a json to save metadata
            const metadata = await createMetadata(characterInfo, message, fileId, charName, folderName, fileHash);
            filesToCreate[`${dirName}/metadata.json`] = {
                content: JSON.stringify(metadata, null, 2),
                commitMessage: `Add metadata for: ${charName}`,
                append: true
            };

            // Create/update all files at once
            for (const [filePath, fileInfo] of Object.entries(filesToCreate)) {
                await createOrUpdateFile(
                    filePath,
                    fileInfo.content,
                    fileInfo.commitMessage,
                    fileInfo.append || false
                );
            }

            console.log('           Successfully processed all character files!\n');

            return {
                path: dirName || "",                                    // Character path
                name: charName || "",                       // Character name
                shareUrl: characterInfo.link || "",               // Share URL
                authorId: message.publicId || "",               // Author ID
                shareLinkFileHash: fileHash || "", // File hash
                authorName: message.username || message.userNickname || message.publicId || 'Anonymous',     // Author name
                authorAvatar: message.userAvatarUrl || 'https://user-uploads.perchance.org/file/f3f799e2a2071112dfa4f0d5b24bbe8f.webp', // get the avatar of the sharer
                messageTime: message.time || 0,
                channel: message.folderName || 'Unknown'
            }

        } catch (error) {
            console.error('Error processing character:', error);
            console.log('           Character info:', JSON.stringify(characterInfo, null, 2));
            throw error;
        }
    } catch (error) {
        console.error(`Error saving character data: ${charName}`, error);
        throw error;
    }
}

/* -------------------------------------------------------------------------- */
/*                             MESSAGES PROCESSING                            */
/* -------------------------------------------------------------------------- */

/**
 * Main message processing function
 * @param {boolean} fullProcessing - When true, processes all messages up to maxMessagesPerChannel limit
 *                                  ignoring previously processed messages
 */
async function processMessages(fullProcessing = false) {
    console.log('Starting message processing...');
    console.log(`Processing mode: ${fullProcessing ? 'FULL' : 'AUTOMATIC'}`);
    const lastProcessed = await getLastProcessedState();
    const existingLinks = await getLinksFromIndex();
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    for (const channel of CONFIG.channels) {
        console.log("\n");
        console.log("-------------");
        console.log(`Processing channel: ${channel}`);
        console.log(`Fetching messages on: ${CONFIG.baseApiUrl}?folderName=ai-character-chat+${channel}`);
        let skip = 0;
        let latestMessage = null;
        let continueProcessing = true;
        // Reset lastRun counters at the start of each channel processing
        lastProcessed[channel].messagesAnalyzed_lastRun = 0;
        lastProcessed[channel].charactersFound_lastRun = 0;

        while (skip < CONFIG.maxMessagesPerChannel && continueProcessing) {
            const url = `${CONFIG.baseApiUrl}?folderName=ai-character-chat+${channel}&skip=${skip}`;

            try {
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

                const messages = await response.json();
                if (messages.length === 0) {
                    console.log(`No more messages in channel: ${channel}`);
                    break;
                } else {
                    console.log(`   Fetched messages in channel ${channel}: ${messages.length + skip}`);
                    //await delay(1000); // Cooldown
                }

                for (const message of messages) {
                    // Store the very first message of this batch as latest
                    // since messages are returned in reverse chronological order
                    if (latestMessage === null || message.time > latestMessage.time) {
                        latestMessage = message;
                        // Calculate time difference from last run
                        lastProcessed[channel].deltaMinutes = lastProcessed[channel].time ?
                            Math.round((message.time - lastProcessed[channel].time) / (1000 * 60)) : 0;
                    }

                    // In automatic mode (default), stop if we reach a message we've already processed
                    // In full processing mode, continue processing all messages
                    if (!fullProcessing && message.time <= lastProcessed[channel].time) {
                        console.log(`   Reached previously processed message in ${channel}. Time:${lastProcessed[channel].time}`);
                        continueProcessing = false;
                        break;
                    }

                    // Update counters for this message
                    lastProcessed[channel].messagesAnalyzed_Total += 1;
                    lastProcessed[channel].messagesAnalyzed_lastRun += 1;

                    // Process character links
                    const { links: characterLinks, ignored } = extractCharacterLinks(message.message);
                    let newLink = [];

                    // Example of characterLinks content:
                    // [{"character":"Lissa","fileId":"1f8092b94bb0fd4c43cd5d0141dee24e.gz","link":"https://perchance.org/ai-character-chat?data=Lissa~1f8092b94bb0fd4c43cd5d0141dee24e.gz"}]


                    // Check for duplicates and get unique links
                    const { uniqueLinks, duplicateCount } = checkForDuplicateLinks(
                        characterLinks,
                        existingLinks
                    );

                    // Increase the counter for duplicated characters
                    lastProcessed[channel].duplicatedCharacterLink_Total + duplicateCount;
                    lastProcessed[channel].duplicatedCharacterLink_lastRun + duplicateCount;

                    // Log found duplicates
                    if (characterLinks.length !== uniqueLinks.length) {
                        console.log(`       ${duplicateCount} duplicate character links found in message.`);
                        console.log(`       Remaining: ${uniqueLinks.length} unique links to be processed.`);
                    }

                    if (!uniqueLinks) {
                        console.log(`       No character links remaining in message after clean-up. Skipping message.`);
                        continue;
                    }


                    if (ignored) {
                        // Increase the counter for NOSCRAPED characters
                        lastProcessed[channel].charactersIgnored_Total += 1;
                        lastProcessed[channel].charactersIgnored_lastRun += 1;

                    } else if (characterLinks.length > 0) {

                        // Process only unique characters
                        for (const charInfo of uniqueLinks) {
                            newLink = await saveCharacterData(charInfo, message, existingLinks);
                            // Add new links to the existing links array for duplicate checking
                            if (newLink) {
                                existingLinks.push(newLink);

                                // Save the new link to a json file
                                await createOrUpdateFile(
                                    CONFIG.capturedCharactersFile,
                                    JSON.stringify(newLink),
                                    'Update captured characters list',
                                    true
                                );

                                // Update counters - now accounting for duplicates
                                lastProcessed[channel].charactersFound_Total += characterLinks.length;
                                lastProcessed[channel].charactersFound_lastRun += characterLinks.length;
                            }
                        }
                    }

                }

                // Skip to the next batch
                skip += messages.length;


            } catch (error) {
                console.error(`Error processing ${channel}:`, error);
            
                // Check if the error is an HTTP 403
                if (error.message.includes("HTTP Error: 403")) {
                    throw new Error("Access Forbidden (403): Check API authentication or permissions.");
                }
            
                // Check if 'message' exists before logging
                if (typeof message !== "undefined") {
                    console.error(`Current message: ${JSON.stringify(message)}`);
                } else {
                    console.error("No current message available.");
                }
            
                break;
            }
        }

        // Check to see if there was any new message
        // Update the lastProcessed state with the time of the most recent message processed
        if (latestMessage !== null) {
            // Keep existing totals and update only necessary fields
            lastProcessed[channel] = {
                messageId: latestMessage.messageId,
                time: latestMessage.time,
                messagesAnalyzed_Total: lastProcessed[channel].messagesAnalyzed_Total,
                messagesAnalyzed_lastRun: lastProcessed[channel].messagesAnalyzed_lastRun,
                charactersFound_Total: lastProcessed[channel].charactersFound_Total,
                charactersFound_lastRun: lastProcessed[channel].charactersFound_lastRun,
                charactersIgnored_Total: lastProcessed[channel].charactersIgnored_Total,
                charactersIgnored_lastRun: lastProcessed[channel].charactersIgnored_lastRun,
                duplicatedCharacterLink_Total: lastProcessed[channel].duplicatedCharacterLink_Total,
                duplicatedCharacterLink_lastRun: lastProcessed[channel].duplicatedCharacterLink_lastRun,
                duplicatedCharacterHash_Total: lastProcessed[channel].duplicatedCharacterHash_Total,
                duplicatedCharacterHash_lastRun: lastProcessed[channel].duplicatedCharacterHash_lastRun,
                deltaMinutes: lastProcessed[channel].deltaMinutes
            };
        }

        await saveProcessingState(lastProcessed);
    }

    return lastProcessed;
}

/* -------------------------------------------------------------------------- */
/*                                 STATISTICS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Reads the last processed state
 * @returns {Promise<Object>} Channel processing states
 */
async function getLastProcessedState() {
    console.log('Reading last processed state...');
    const state = await getGithubFile(CONFIG.timestampFile);

    // Helper function to create a default channel state
    const createDefaultChannelState = () => ({
        messageId: null,
        time: 0,
        messagesAnalyzed_Total: 0,    // Start from 0 if new
        messagesAnalyzed_lastRun: 0,
        charactersFound_Total: 0,      // Start from 0 if new
        charactersFound_lastRun: 0,
        charactersIgnored_Total: 0,    // Start from 0 if new
        charactersIgnored_lastRun: 0,
        duplicatedCharacterLink_Total: 0,    // Start from 0 if new
        duplicatedCharacterLink_lastRun: 0,
        duplicatedCharacterHash_Total: 0,    // Start from 0 if new
        duplicatedCharacterHash_lastRun: 0,
        deltaMinutes: 0
    });

    if (!state) {
        // If no state exists, create new state for all channels
        return CONFIG.channels.reduce((acc, channel) => {
            acc[channel] = createDefaultChannelState();
            return acc;
        }, {});
    }

    // If state exists, ensure all properties exist with correct types
    CONFIG.channels.forEach(channel => {
        if (!state[channel]) {
            state[channel] = createDefaultChannelState();
        } else {
            // Ensure numeric properties are initialized properly
            state[channel].messagesAnalyzed_Total = state[channel].messagesAnalyzed_Total || 0;
            state[channel].charactersFound_Total = state[channel].charactersFound_Total || 0;
            state[channel].charactersIgnored_Total = state[channel].charactersIgnored_Total || 0;
            state[channel].duplicatedCharacterLink_Total = state[channel].duplicatedCharacterLink_Total || 0;
            state[channel].duplicatedCharacterHash_Total = state[channel].duplicatedCharacterHash_Total || 0;
            state[channel].messagesAnalyzed_lastRun = 0;
            state[channel].charactersFound_lastRun = 0;
            state[channel].charactersIgnored_lastRun = 0;
            state[channel].duplicatedCharacterLink_lastRun = 0;
            state[channel].duplicatedCharacterHash_lastRun = 0;
            state[channel].deltaMinutes = state[channel].deltaMinutes || 0;
        }
    });

    return state;
}

/**
 * Saves processing state
 * @param {Object} state - Current processing state
 */
async function saveProcessingState(state) {
    console.log('Saving processing state...');
    await createOrUpdateFile(
        CONFIG.timestampFile,
        JSON.stringify(state, null, 2),
        'Update last processed state',
        false
    );
}

/**
 * Generates a summary of processing statistics
 * @param {Object} state - The final processing state
 * @returns {Object} Summary of total messages and characters
 */
function generateProcessingSummary(state) {
    if (!state) {
        console.log('No state available for summary');
        return;
    }

    const summary = {
        totalMessagesAnalyzed: 0,
        totalCharactersFound: 0,
        totalCharactersIgnored: 0,
        messagesThisRun: 0,
        charactersThisRun: 0,
        charactersIgnoredThisRun: 0,
        duplicatedCharacterLinkThisRun: 0,
        duplicatedCharacterHashThisRun: 0
    };

    CONFIG.channels.forEach(channel => {
        if (state[channel]) {
            summary.totalMessagesAnalyzed += state[channel].messagesAnalyzed_Total || 0;
            summary.totalCharactersFound += state[channel].charactersFound_Total || 0;
            summary.totalCharactersIgnored += state[channel].charactersIgnored_Total || 0;
            summary.messagesThisRun += state[channel].messagesAnalyzed_lastRun || 0;
            summary.charactersThisRun += state[channel].charactersFound_lastRun || 0;
            summary.charactersIgnoredThisRun += state[channel].charactersIgnored_lastRun || 0;
            summary.duplicatedCharacterLinkThisRun += state[channel].duplicatedCharacterLink_lastRun || 0;
            summary.duplicatedCharacterHashThisRun += state[channel].duplicatedCharacterHash_lastRun || 0;
        }
    });

    return summary;
}

/* -------------------------------------------------------------------------- */
/*                               INITIALIZATION                               */
/* -------------------------------------------------------------------------- */

// Main execution
console.log(`Starting Perchance Comment Scraper ${scriptVersion}...`);
processMessages(fullProcessing)
    .then((lastProcessed) => {
        const summary = generateProcessingSummary(lastProcessed);

        console.log('\n=== Processing Summary ===');
        console.log(`Total Messages Analyzed (All Time): ${summary.totalMessagesAnalyzed}`);
        console.log(`Total Characters Found (All Time): ${summary.totalCharactersFound}`);
        console.log(`Total Characters Ignored (All Time): ${summary.totalCharactersIgnored}`);
        console.log('\nThis Run:');
        console.log(`Messages Analyzed: ${summary.messagesThisRun}`);
        console.log(`Characters Found: ${summary.charactersThisRun}`);
        console.log(`Characters Ignored: ${summary.charactersIgnoredThisRun}`);
        console.log(`Duplicated Character Links: ${summary.duplicatedCharacterLinkThisRun}`);
        console.log(`Duplicated Character Hashes: ${summary.duplicatedCharacterHashThisRun}`);

        // Channel-specific statistics
        console.log('\nPer Channel Statistics (This Run):');
        CONFIG.channels.forEach(channel => {
            if (lastProcessed[channel] &&
                (lastProcessed[channel].messagesAnalyzed_lastRun > 0 ||
                    lastProcessed[channel].charactersFound_lastRun > 0)) {
                console.log(`${channel}: ${lastProcessed[channel].messagesAnalyzed_lastRun} messages, ${lastProcessed[channel].charactersFound_lastRun} characters`);
            }
        });

        console.log('\nProcessing completed successfully');
    })
    .catch(error => {
        console.error('Processing failed:', error);
        process.exit(1);
    });
