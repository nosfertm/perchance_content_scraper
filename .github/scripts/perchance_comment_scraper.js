// perchance_comment_scraper.js
// Scrapes the comment section on perchance
// Code heavily inspired on VioneT20 code.

import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';
import path from 'path';
import * as https from 'https';

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

const CONFIG = {
    channels: ["chat", "chill", "rp", "spam", "vent", "share"],
    maxMessagesPerChannel: 5200,
    baseApiUrl: "https://comments-plugin.perchance.org/api/getMessages",
    timestampFile: "last_processed.json",
    targetBranch: process.env.TARGET_BRANCH || "main",
    outputDir: path.join("ai-character-char", "characters", "scrape", "perchance_comments"),
    owner: process.env.GITHUB_REPOSITORY?.split('/')[0],
    repo: process.env.GITHUB_REPOSITORY?.split('/')[1]
};

const LINK_PATTERN = /(perchance\.org\/(.+?)\?data=(.+?)~(.+?)\.gz)/;

/**
 * Sanitizes a string while preserving readable characters
 * @param {string} str - String to sanitize
 * @returns {string} Sanitized string safe for filesystem use
 */
function sanitizeString(str) {
    if (!str) return 'unnamed';

    return str
        .normalize('NFKD')                // Normalize Unicode characters
        .replace(/[\u0300-\u036f]/g, '')  // Remove diacritical marks
        .replace(/[\u{1F300}-\u{1FAD6}]/gu, '') // Remove emojis
        .replace(/[^a-zA-Z0-9\s-]/g, '_') // Replace any non-alphanumeric chars (except spaces and hyphens) with underscore
        .replace(/\s+/g, ' ')            // Replace multiple spaces with single space
        .replace(/_{2,}/g, '_')          // Replace multiple underscores with single
        .replace(/^_|_$/g, '')           // Remove leading/trailing underscores
        .trim();                         // Trim whitespace
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
 * Creates or updates a file in GitHub repository
 * @param {string} filePath - Path to file
 * @param {string} content - File content
 * @param {string} message - Commit message
 */
async function createOrUpdateFile(filePath, content, message, b64 = false, log = true) {
    try {
        // Check if file exists
        let sha;
        try {
            const file = await octokit.repos.getContent({
                owner: CONFIG.owner,
                repo: CONFIG.repo,
                path: filePath,
                ref: CONFIG.targetBranch
            });
            sha = file.data.sha;
        } catch (error) {
            if (error.status !== 404) throw error;
        }

        // Convert content to base64, handling both Buffer and string inputs
        // const contentBuffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
        // const contentBase64 = contentBuffer.toString('base64');

        let contentBase64

        if (b64) {
            contentBase64 = Buffer.from(content).toString('base64')
        } else {
            contentBase64 = content.toString('base64');
        }

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

        if (log) console.log(`           Successfully ${sha ? 'updated' : 'created'} ${filePath}`);
    } catch (error) {
        console.error(`Error creating/updating file ${filePath}:`, error);
        throw error;
    }
}


/**
 * Downloads file from URL and returns it as a Buffer
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} File content as Buffer
 */
async function downloadFile(url) {
    const fileData = await new Promise((resolve, reject) => {
        https.get(downloadUrl, (response) => {
            // Check if download was successful
            if (response.statusCode !== 200) {
                reject(new Error(`Download falhou: ${response.statusCode}`));
                return;
            }

            // Create store file data 
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                // Combina todos os chunks e converte para base64
                const buffer = Buffer.concat(chunks);
                resolve(buffer);
            });
        }).on('error', reject);
    });

    return fileData
}

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
            state[channel].messagesAnalyzed_lastRun = 0;
            state[channel].charactersFound_lastRun = 0;
            state[channel].charactersIgnored_lastRun = 0;
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
 * Extracts character links from a message.
 * If a character link is found and the message contains "NOSCRAPE", that character is ignored.
 * @param {string} message - The message text containing links.
 * @returns {Object} Object containing links array and ignored status
 */
function extractCharacterLinks(message) {
    // First, extract all potential character links
    const links = message
        .split(/(\s+|(?<=gz),)/gm) // Keeps spaces and ",gz" as split points.
        .filter(a => a.includes('data=')) // Filters out elements that don't contain 'data='.
        .map(a => {
            // Extracts the link using a predefined pattern.
            const match = a.match(LINK_PATTERN);
            if (!match) return null;

            const fullLink = match[0]; // Full matched link.
            const data = fullLink.split('data=')[1]; // Extracts the data part of the link.
            const [character, fileId] = data.split('~'); // Splits character name and file ID.

            return {
                character: decodeURI(character), // Decodes the character name.
                fileId: fileId, // Stores the file ID.
                link: `https://${fullLink.trim()}` // Constructs the full HTTPS link.
            };
        })
        .filter(Boolean); // Removes null values from the array.

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
 * Saves character data and returns information needed for metadata
 * @param {Object} characterInfo - Character information
 * @param {Object} message - Original message
 * @returns {Object} Directory and character information for metadata
 */
/**
 * Saves character data, including the .gz file, message capture, and metadata
 * @param {Object} characterInfo - Character information (name, fileId, link)
 * @param {Object} message - Original message containing the character
 */
async function saveCharacterData(characterInfo, message) {
    console.log("\n");
    console.log("       --------------------");
    console.log(`       Processing character!`);
    try {
        // Sanitize character and author names for safe filesystem usage
        const charName = sanitizeString(characterInfo.character);
        console.log(`           Character's name: ${charName}`);

        // Get author name from available fields, fallback to 'Anonymous'
        const authorName = sanitizeString(message.username || message.userNickname || message.publicId || 'Anonymous');
        console.log(`           Author's name: ${authorName}`);

        // Create directory path using sanitized names
        const dirName = path.join(CONFIG.outputDir, `${charName} by ${authorName}`);
        console.log(`           Path: ${dirName}`);

        const fileId = sanitizeFileName(characterInfo.fileId);
        console.log(`           fileId: ${fileId}`);
        const gzPath = `${dirName}/${fileId}`;

        // Log the start of the download
        console.log(`           Downloading: ${characterInfo.link}`);

        // Download the .gz file content
        const fileContent = await downloadFile(characterInfo.link);

        // Save the downloaded file to the repository
        await createOrUpdateFile(
            gzPath,
            fileContent,
            `Add character file: ${charName}`
        );

        // Save the original message
        const capturedMessage = { ...message };
        await createOrUpdateFile(
            `${dirName}/capturedMessage.json`,
            JSON.stringify(capturedMessage, null, 2),
            `Add capturedMessage for: ${charName}`
        );

        // Create metadata wrapped in an array for future extensibility
        const metadata = [{
            characterName: characterInfo.character || 'Unnamed',
            fileId: fileId,
            link: characterInfo.link,
            authorName: message.username || message.userNickname || message.publicId || 'Anonymous',
            authorId: message.publicId || 'Unknown'
        }];

        // Save metadata.json file in the character's directory
        await createOrUpdateFile(
            `${dirName}/metadata.json`,
            JSON.stringify(metadata, null, 2),
            `Add metadata for: ${charName}`
        );

    } catch (error) {
        console.error(`Error saving character data: ${charName}`, error);
        throw error;
    }
}

/**
 * Main message processing function
 */
async function processMessages() {
    console.log('Starting message processing...');
    const lastProcessed = await getLastProcessedState();

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
                    console.log(`   Fetched messages in channel ${channel}: ${200 + skip}`);
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

                    // Stop if we reach a message we've already processed
                    if (message.time <= lastProcessed[channel].time) {
                        console.log(`   Reached previously processed message in ${channel}`);
                        continueProcessing = false;
                        break;
                    }

                    // Update counters for this message
                    lastProcessed[channel].messagesAnalyzed_Total += 1;
                    lastProcessed[channel].messagesAnalyzed_lastRun += 1;

                    // Process character links
                    const { links: characterLinks, ignored } = extractCharacterLinks(message.message);
                    if (ignored) {
                        // Increase the counter for NOSCRAPED characters
                        lastProcessed[channel].charactersIgnored_Total += 1;
                        lastProcessed[channel].charactersIgnored_lastRun += 1;
                    } else if (characterLinks.length > 0) {
                        // Process characters if found any
                        lastProcessed[channel].charactersFound_Total += characterLinks.length;
                        lastProcessed[channel].charactersFound_lastRun += characterLinks.length;

                        // Process each character found - now passing all characterLinks to the function
                        for (const charInfo of characterLinks) {
                            await saveCharacterData(charInfo, message);
                        }
                    }

                }

                // Skip to the next batch
                skip += messages.length;

            } catch (error) {
                console.error(`Error processing ${channel}:`, error);
                console.error(`Current message ${JSON.stringify(message)}:`, error);
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
                deltaMinutes: lastProcessed[channel].deltaMinutes
            };
        }

        await saveProcessingState(lastProcessed);
    }

    return lastProcessed;
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
        charactersIgnoredThisRun: 0
    };

    CONFIG.channels.forEach(channel => {
        if (state[channel]) {
            summary.totalMessagesAnalyzed += state[channel].messagesAnalyzed_Total || 0;
            summary.totalCharactersFound += state[channel].charactersFound_Total || 0;
            summary.totalCharactersIgnored += state[channel].charactersIgnored_Total || 0;
            summary.messagesThisRun += state[channel].messagesAnalyzed_lastRun || 0;
            summary.charactersThisRun += state[channel].charactersFound_lastRun || 0;
            summary.charactersIgnoredThisRun += state[channel].charactersIgnored_lastRun || 0;
        }
    });

    return summary;
}


// Main execution
console.log('Starting Perchance Comment Scraper 2.1...');
processMessages()
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
