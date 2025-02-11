// Import required Node.js modules
// 'fs' is for file system operations
// 'https' is for making HTTP requests
const fs = require('fs');
const https = require('https');

// Function to download and save a GZ file
function downloadAndSaveGzFile(fileId) {
    // Create the download URL
    const downloadUrl = `https://user-uploads.perchance.org/file/${fileId}`;
    
    // Define the output file name
    const outputFile = `file_${fileId}`;

    // Create a write stream to save the file
    const fileStream = fs.createWriteStream(outputFile);

    // Make the HTTP request
    https.get(downloadUrl, (response) => {
        // Check if request was successful (status code 200)
        if (response.statusCode !== 200) {
            console.error(`Failed to download: ${response.statusCode}`);
            return;
        }

        // Pipe the response directly to the file
        // 'pipe' connects the download stream to the file saving stream
        response.pipe(fileStream);

        // When the download is complete
        fileStream.on('finish', () => {
            fileStream.close();
            console.log(`File saved as ${outputFile}`);
        });
    }).on('error', (err) => {
        // If there's an error during download
        console.error('Error downloading file:', err.message);
        // Remove the partially downloaded file
        fs.unlink(outputFile, () => {});
    });
}

// Example usage - replace 'your-file-id' with the actual file ID
downloadAndSaveGzFile('462d8d1f91b3febeaa3e0dfb676cadfc.gz');