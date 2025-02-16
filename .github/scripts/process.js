// TODO - ADD tokens, and API CONFIGS (RATE LIMIT, MAX CALLS...)

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
const fs = require('fs').promises;
const path = require('path');
const util = require('util');
const gzip = require('zlib').gzip;
const gunzip = require('zlib').gunzip;
const { parse } = require('url');
const querystring = require('querystring');

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

/**
 * Main function to process characters
 */
async function processCharacters() {
  console.log("Starting character processing...");
  
  try {
    // Get list of character folders to process
    const characterFolders = await getCharacterFolders();
    console.log(`Found ${characterFolders.length} characters to process`);

    // TODO (CLAUDE) - SHUFFLE characterFolders order form random process rather than alphabetical
    
    // Process only up to MAX_CHARACTERS_PER_RUN (Shuffled)
    const foldersToProcess = characterFolders.slice(0, CONFIG.MAX_CHARACTERS_PER_RUN);
    
    // Process each character
    for (const folder of foldersToProcess) {
      try {
        await processCharacter(folder);
      } catch (error) {
        console.error(`Error processing character in folder ${folder}:`, error);
        stats.errors.push({ folder, error: error.message });
      }
    }
    
    // Print final statistics
    printStats();
    
  } catch (error) {
    console.error("Fatal error during processing:", error);
    process.exit(1);
  }
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


/**
 * Process a single character
 * @param {string} folder - Character folder name
 */
async function processCharacter(folder) {
  console.log(`Processing character: ${folder}`);
  
  // Read metadata.json
  const metadata = await readJsonFile(path.join(CONFIG.SOURCE_PATH, folder, CONFIG.METADATA_FILE));

  // Read quota
  //const apiQuota = await readJsonFile(path.join(CONFIG...));

  // TODO (CLAUDE) - Create mock function to check if this character/files already exists on the output directory, if so, move it to the duplicated folder, create a simple file referring to the content already existing, go to the next execution.

  // TODO (CLAUDE) - Check if file fileID exist, if it doesn't download it (create a mock function for download)
  gzFile = metadata.fileId;
  
  // Extract character information from gz file
  const characterData = await extractCharacterData(folder, metadata.fileId);
  
  // Call AI for analysis (placeholder for now) 
  // TODO (CLAUDE) If there's no quota, decide whether or not to halt and exit execution
  const aiAnalysis = await analyzeCharacterWithAI(characterData);

  // TODO (CLAUDE) - Create mock function to call pigimage API and generate new image if the character doesn't have one

  // TODO (CLAUDE) - Create mock function to call freeimage API and upload the image.
  
  // Determine destination based on AI analysis
  const destinationPath = determineDestinationPath(aiAnalysis);
  
  // Create character structure in destination
  await createCharacterStructure(folder, metadata, characterData, aiAnalysis, destinationPath);
  
  // Remove source folder after successful processing
  await removeSourceFolder(folder);
  
  // Update statistics
  updateStats(aiAnalysis.rating);
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
 * Read and parse metadata.json file
 * @param {string} filePath - Path to json file
 */
async function readJsonFile(filePath) {
  const jsonPath = path.join(filePath);
  const data = await fs.readFile(jsonPath, 'utf8');
  return JSON.parse(data);
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
  
  // Write files to destination
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

/**
 * Remove source folder after successful processing
 * @param {string} folder - Folder name to remove
 */
async function removeSourceFolder(folder) {
  await fs.rm(path.join(CONFIG.SOURCE_PATH, folder), { recursive: true });
}

/**
 * Update processing statistics
 * @param {string} rating - Character rating from AI analysis
 */
function updateStats(rating) {
  stats.processed++;
  switch(rating) {
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

// Start processing
processCharacters().catch(console.error);
