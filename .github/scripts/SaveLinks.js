// Import required Node.js modules for file system operations
const fs = require('fs').promises;
const path = require('path');

const processedFolderFileName = 'folder.processed.1'

// Initialize arrays to store messages and missing files
let messages = [];
let detMessages = [];
let missingFiles = [];

// Main function to process directories
async function processDirectories(mainDirectory) {
    try {
        // Get all items in the main directory
        const items = await fs.readdir(mainDirectory);

        // Process each subdirectory
        for (const item of items) {
            const subdirPath = path.join(mainDirectory, item);

            // Check if the current item is a directory
            const stats = await fs.stat(subdirPath);
            if (!stats.isDirectory()) continue;

            // Process the files in this subdirectory
            await processSubdirectory(subdirPath);
        }

        // Sort messages by time in chronological order (older first)
        messages.sort((a, b) => a.time - b.time);
        detMessages.sort((a, b) => a.time - b.time);

        // Write the messages compilation file
        await fs.writeFile(
            path.join(mainDirectory, 'messages.json'),
            JSON.stringify(messages, null, 2),
            'utf8'
        );

        // Write the messages compilation file
        await fs.writeFile(
            path.join(mainDirectory, 'detailedMessages.json'),
            JSON.stringify(detMessages, null, 2),
            'utf8'
        );

        // Write the missing files compilation
        await fs.writeFile(
            path.join(mainDirectory, 'missing.json'),
            JSON.stringify(missingFiles, null, 2),
            'utf8'
        );

        console.log('Processing completed successfully!');
        console.log(`Processed ${messages.length} messages`);
        console.log(`Found ${missingFiles.length} directories with missing files`);
    } catch (error) {
        console.error('Error processing directories:', error);
    }
}

// Function to process each subdirectory
async function processSubdirectory(subdirPath) {
    try {
        // Check if folder was already processed
        const isProcessed = await fileExists(path.join(subdirPath, processedFolderFileName));
        if (isProcessed) {
            console.log(`Folder already processed: ${subdirPath}`);
            return;
        }

        // Check if capturedMessage.json exists
        const capturedMessagePath = path.join(subdirPath, 'capturedMessage.json');
        const hasCapturedMessage = await fileExists(capturedMessagePath);

        // Check if metadata.json exists
        const metadataPath = path.join(subdirPath, 'metadata.json');
        const hasMetadata = await fileExists(metadataPath);

        let messageData = null;

        if (hasCapturedMessage) {
            // Read capturedMessage.json
            messageData = JSON.parse(await fs.readFile(capturedMessagePath, 'utf8'));
        } else if (hasMetadata) {
            // Read metadata.json
            messageData = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        }

        if (messageData) {
            // Add the message to our collection
            messages.push({
                ...messageData
            });

            // Add the message with details to our collection
            detMessages.push({
                ...messageData,
                sourcePath: subdirPath,
                sourceFile: hasCapturedMessage ? 'capturedMessage.json' : 'metadata.json'
            });detMessages

            // Create processed marker file
            await fs.writeFile(
                path.join(subdirPath, processedFolderFileName),
                JSON.stringify({ 
                    processedAt: new Date().toISOString(),
                    sourceFile: hasCapturedMessage ? 'capturedMessage.json' : 'metadata.json'
                }, null, 2),
                'utf8'
            );
        } else {
            // Add to missing files list
            missingFiles.push({
                path: subdirPath,
                processedAt: new Date().toISOString(),
                error: 'No capturedMessage.json or metadata.json found'
            });
        }

    } catch (error) {
        // Add to missing files list with error
        missingFiles.push({
            path: subdirPath,
            processedAt: new Date().toISOString(),
            error: error.message
        });
        console.error(`Error processing subdirectory ${subdirPath}:`, error);
    }
}

// Helper function to check if a file exists
async function fileExists(filePath) {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

// Example usage of the script
const mainDirectory = 'ai-character-char/characters/scrape/perchance_comments';
processDirectories(mainDirectory);