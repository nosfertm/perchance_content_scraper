// perchance_comment_scraper.js
// Scrapes the comment section on perchance
// Code heavily inspired on VioneT20 code.

import { Octokit } from '@octokit/rest';
import fetch from 'node-fetch';
import { promises as fs } from 'fs';
import path from 'path';

const octokit = new Octokit({
    auth: process.env.GITHUB_TOKEN
});

const CONFIG = {
    channels: ["chat", "chill", "rp", "spam", "vent", "share"],
    maxMessagesPerChannel: 5200,
    baseApiUrl: "https://comments-plugin.perchance.org/api/getMessages",
    timestampFile: "last_processed.json",
    targetBranch: process.env.TARGET_BRANCH || "main",
    outputDir: "characters",
    owner: process.env.GITHUB_REPOSITORY?.split('/')[0],
    repo: process.env.GITHUB_REPOSITORY?.split('/')[1]
};

const LINK_PATTERN = /(perchance\.org\/(.+?)\?data=(.+?)~(.+?)\.gz)/;

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
async function createOrUpdateFile(filePath, content, message, log = true) {
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

        // Create or update file
        await octokit.repos.createOrUpdateFileContents({
            owner: CONFIG.owner,
            repo: CONFIG.repo,
            path: filePath,
            message: message,
            content: Buffer.from(content).toString('base64'),
            branch: CONFIG.targetBranch,
            sha: sha
        });

        if (log) console.log(`           Successfully ${sha ? 'updated' : 'created'} ${filePath}`);
    } catch (error) {
        console.error(`         Error creating/updating file ${filePath}:`, error);
        throw error;
    }
}

/**
 * Downloads file from URL
 * @param {string} url - URL to download from
 * @returns {Promise<Buffer>} File content
 */
async function downloadFile(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
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
            state[channel].messagesAnalyzed_lastRun = 0;  // Reset for new run
            state[channel].charactersFound_lastRun = 0;   // Reset for new run
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
 * If the message contains "NOSCRAPE", logs a warning and returns null.
 * @param {string} message - The message text containing links.
 * @returns {Array|null} Array of unique character objects or null if NOSCRAPE is found.
 */
function extractCharacterLinks(message) {
    // Check if the message contains "NOSCRAPE"
    if (message.includes('NOSCRAPE')) {
        console.warn('Character links were not processed due to NOSCRAPE restriction.');
        return null;
    }
    // Split the message into segments using spaces and commas as delimiters.
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

    // Removes duplicate objects by converting them to JSON and back.
    return [...new Set(links.map(JSON.stringify))].map(JSON.parse);
}


/**
 * Saves character data
 * @param {Object} characterInfo - Character information
 * @param {Object} message - Original message
 */
async function saveCharacterData(characterInfo, message) {
    console.log(`       Processing character: ${characterInfo.character}`);
    try {
        const dirName = `${CONFIG.outputDir}/${characterInfo.character} by ${message.username || message.userNickname || message.publicId || 'unknown'}`;
        const gzPath = `${dirName}/${characterInfo.fileId}`;

        // Download .gz file
        console.log(`           Downloading: ${characterInfo.link}`);
        const fileContent = await downloadFile(characterInfo.link);

        // Save .gz file
        await createOrUpdateFile(
            gzPath,
            fileContent.toString('base64'),
            `Add character file: ${characterInfo.character}`
        );

        // Save metadata
        const metadata = { ...message };

        await createOrUpdateFile(
            `${dirName}/metadata.json`,
            JSON.stringify(metadata, null, 2),
            `Add metadata for: ${characterInfo.character}`
        );

    } catch (error) {
        console.error(`Error saving character data: ${characterInfo.character}`, error);
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
        console.log("");
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
                    console.log(`   Fetched messages in channel ${channel}: ${200+skip}`);
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
                    const characterLinks = extractCharacterLinks(message.message);
                    lastProcessed[channel].charactersFound_Total += characterLinks.length;
                    lastProcessed[channel].charactersFound_lastRun += characterLinks.length;
                
                    // Process each character found
                    for (const charInfo of characterLinks) {
                        await saveCharacterData(charInfo, message);
                    }
                }
                

                // Skip to the next batch
                skip += messages.length;

            } catch (error) {
                console.error(`Error processing ${channel}:`, error);
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
                deltaMinutes: lastProcessed[channel].deltaMinutes
            };
        }        

        await saveProcessingState(lastProcessed);
    }
}

/**
 * Generates a summary of processing statistics
 * @param {Object} state - The final processing state
 * @returns {Object} Summary of total messages and characters
 */
function generateProcessingSummary(state) {
    // Initialize counters for grand totals
    const summary = {
        totalMessagesAnalyzed: 0,
        totalCharactersFound: 0,
        messagesThisRun: 0,
        charactersThisRun: 0,
        channelStats: {}
    };

    // Calculate totals across all channels
    Object.entries(state).forEach(([channel, stats]) => {
        // Add to grand totals
        summary.totalMessagesAnalyzed += stats.messagesAnalyzed_Total || 0;
        summary.totalCharactersFound += stats.charactersFound_Total || 0;
        summary.messagesThisRun += stats.messagesAnalyzed_lastRun || 0;
        summary.charactersThisRun += stats.charactersFound_lastRun || 0;

        // Store per-channel statistics
        summary.channelStats[channel] = {
            messages: stats.messagesAnalyzed_lastRun || 0,
            characters: stats.charactersFound_lastRun || 0
        };
    });

    return summary;
}

// Main execution
console.log('Starting Perchance Comment Scraper...');
processMessages()
    .then((lastProcessed) => {
        const summary = generateProcessingSummary(lastProcessed);
        
        console.log('\n=== Processing Summary ===');
        console.log(`Total Messages Analyzed (All Time): ${summary.totalMessagesAnalyzed}`);
        console.log(`Total Characters Found (All Time): ${summary.totalCharactersFound}`);
        console.log('\nThis Run:');
        console.log(`Messages Analyzed: ${summary.messagesThisRun}`);
        console.log(`Characters Found: ${summary.charactersThisRun}`);
        
        console.log('\nPer Channel Statistics (This Run):');
        Object.entries(summary.channelStats).forEach(([channel, stats]) => {
            if (stats.messages > 0 || stats.characters > 0) {
                console.log(`${channel}: ${stats.messages} messages, ${stats.characters} characters`);
            }
        });
        
        console.log('\nProcessing completed successfully');
    })
    .catch(error => {
        console.error('Processing failed:', error);
        process.exit(1);
    });
