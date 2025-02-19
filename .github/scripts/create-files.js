// Import required Node.js modules for file system operations
const fs = require('fs').promises;
const path = require('path');

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
        
        console.log('Processing completed successfully!');
    } catch (error) {
        console.error('Error processing directories:', error);
    }
}

// Function to process each subdirectory
async function processSubdirectory(subdirPath) {
    try {
        // Check if capturedMessage.json exists
        const hasCapturedMessage = await fileExists(path.join(subdirPath, 'capturedMessage.json'));
        
        if (!hasCapturedMessage) {
            // Check if metadata.json exists to be renamed
            const hasMetadata = await fileExists(path.join(subdirPath, 'metadata.json'));
            
            if (hasMetadata) {
                // Rename metadata.json to capturedMessage.json
                await fs.rename(
                    path.join(subdirPath, 'metadata.json'),
                    path.join(subdirPath, 'capturedMessage.json')
                );
                
                // Read the newly renamed file
                const capturedData = JSON.parse(
                    await fs.readFile(path.join(subdirPath, 'capturedMessage.json'), 'utf8')
                );
                
                // Create new metadata using the captured data
                const newMetadata = createNewMetadata(capturedData, path.basename(subdirPath));
                
                // Write the new metadata.json file
                await fs.writeFile(
                    path.join(subdirPath, 'metadata.json'),
                    JSON.stringify([newMetadata], null, 2),
                    'utf8'
                );
                
                console.log(`Processed directory: ${subdirPath}`);
            }
        }
    } catch (error) {
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

// Function to create new metadata object from captured message data
function createNewMetadata(capturedData, folderName) {
    // Extract the first valid link from message
    const messageLinks = extractLinks(capturedData.message);
    const firstLink = messageLinks[0] || '';
    
    // Extract character name and fileId from the link
    const { characterName, fileId } = parseLink(firstLink);
    
    // Extract character name from folder name (before 'by')
    const characterName_Sanitized = folderName.split(' by ')[0];
    
    // Create the new metadata object
    return {
        folderName: folderName,
        characterName: characterName,
        characterName_Sanitized: characterName_Sanitized,
        fileId: fileId,
        link: firstLink,
        authorName: capturedData.userNickname || 
                   capturedData.userName || 
                   capturedData.publicId || 
                   'Anonymous',
        authorId: capturedData.publicId
    };
}

// Function to extract valid links from message
function extractLinks(message) {
    if (!message) return [];
    
    // Split message by spaces and find valid links
    return message.split(' ')
        .filter(word => {
            // Check if word contains required parts of the link
            return word.includes('perchance.org/ai-character-chat?data=') &&
                   word.includes('~') &&
                   word.includes('.gz');
        });
}

// Function to parse link and extract character name and fileId
function parseLink(link) {
    if (!link) return { characterName: '', fileId: '' };
    
    // Find the position of 'data=' and '~' in the link
    const dataIndex = link.indexOf('data=');
    const tildeIndex = link.indexOf('~');
    
    if (dataIndex === -1 || tildeIndex === -1) {
        return { characterName: '', fileId: '' };
    }
    
    // Extract character name (between 'data=' and '~')
    const characterName = link.substring(dataIndex + 5, tildeIndex);
    
    // Extract fileId (after '~' until end of string)
    const fileId = link.substring(tildeIndex + 1);
    
    return { characterName, fileId };
}

// Example usage of the script
const mainDirectory = './your-directory-path';
processDirectories(mainDirectory);