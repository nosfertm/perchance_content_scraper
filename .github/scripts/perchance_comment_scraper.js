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
            console.log(`File ${path} not found, creating new...`);
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
async function createOrUpdateFile(filePath, content, message) {
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

        console.log(`Successfully ${sha ? 'updated' : 'created'} ${filePath}`);
    } catch (error) {
        console.error(`Error creating/updating file ${filePath}:`, error);
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

    if (!state) {
        // Initialize state for all channels
        return CONFIG.channels.reduce((acc, channel) => {
            acc[channel] = { messageId: null, time: 0, messagesAnalyzed: 0, charactersFound: 0 };
            return acc;
        }, {});
    }

    // Ensure all channels exist in state
    CONFIG.channels.forEach(channel => {
        if (!state[channel]) {
            state[channel] = { messageId: null, time: 0, messagesAnalyzed: 0, charactersFound: 0 };
        } else {
            if (!state[channel].hasOwnProperty('messagesAnalyzed')) state[channel].messagesAnalyzed = 0;
            if (!state[channel].hasOwnProperty('charactersFound')) state[channel].charactersFound = 0;
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
        'Update last processed state'
    );
}

/**
 * Extracts character links from message
 * @param {string} message - Message text
 * @returns {Array} Array of character objects
 */
function extractCharacterLinks(message) {
    console.log('Extracting character links from message...');
    const links = message
        .split(/(\s+|(?<=gz),)/gm)
        .filter(a => a.includes('data='))
        .map(a => {
            const match = a.match(LINK_PATTERN);
            if (!match) return null;
            
            const fullLink = match[0];
            const data = fullLink.split('data=')[1];
            const [character, fileId] = data.split('~');
            
            return {
                character: decodeURI(character),
                fileId: fileId,
                link: `https://${fullLink.trim()}`
            };
        })
        .filter(Boolean);

    return [...new Set(links.map(JSON.stringify))].map(JSON.parse);
}

/**
 * Saves character data
 * @param {Object} characterInfo - Character information
 * @param {Object} message - Original message
 */
async function saveCharacterData(characterInfo, message) {
    console.log(`Processing character: ${characterInfo.character}`);
    try {
        const dirName = `${CONFIG.outputDir}/${characterInfo.character} by ${message.username || 'unknown'}`;
        const gzPath = `${dirName}/${characterInfo.fileId}`;
        
        // Download .gz file
        console.log(`Downloading: ${characterInfo.link}`);
        const fileContent = await downloadFile(characterInfo.link);
        
        // Save .gz file
        await createOrUpdateFile(
            gzPath,
            fileContent.toString('base64'),
            `Add character file: ${characterInfo.character}`
        );

        // Save metadata
        const metadata = {
            folderName: message.folderName,
            message: message.message,
            messageId: message.messageId,
            time: message.time,
            username: message.username,
            userNickname: message.userNickname,
            userAvatarUrl: message.userAvatarUrl,
            publicId: message.publicId
        };

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
        console.log(`\nProcessing channel: ${channel}`);
        let skip = 0;
        let continueProcessing = true;
        
        while (skip < CONFIG.maxMessagesPerChannel && continueProcessing) {
            const url = `${CONFIG.baseApiUrl}?folderName=ai-character-chat+${channel}&skip=${skip}`;
            
            try {
                console.log(`Fetching messages: ${url}`);
                const response = await fetch(url);
                if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
                
                const messages = await response.json();
                if (messages.length === 0) {
                    console.log(`No more messages in channel: ${channel}`);
                    break;
                } else {
                    console.log(`Fetched ${messages.length} messages in channel: ${channel}`);
                }

                for (const message of messages) {
                    if (message.time <= lastProcessed[channel].time) {
                        console.log(`Reached previously processed message in ${channel}`);
                        console.log("   ", JSON.stringify(lastProcessed[channel]))
                        continueProcessing = false;
                        break;
                    }

                    // Count messages
                    lastProcessed[channel].messagesAnalyzed += 1;

                    // Count characters found
                    const characterLinks = extractCharacterLinks(message.message);
                    lastProcessed[channel].charactersFound += characterLinks.length;
                    
                    for (const charInfo of characterLinks) {
                        await saveCharacterData(charInfo, message);
                    }

                    lastProcessed[channel] = {
                        messageId: message.messageId,
                        time: message.time,
                        messagesAnalyzed: lastProcessed[channel].messagesAnalyzed,
                        charactersFound: lastProcessed[channel].charactersFound
                    };                    
                }

                await saveProcessingState(lastProcessed);
                skip += messages.length;

            } catch (error) {
                console.error(`Error processing ${channel}:`, error);
                break;
            }
        }
    }
}

// Main execution
console.log('Starting Perchance Comment Scraper...');
processMessages()
    .then(() => console.log('Processing completed successfully'))
    .catch(error => {
        console.error('Processing failed:', error);
        process.exit(1);
    });
