const fs = require('fs');
const path = require('path');

const rootDir = 'ai-character-char/characters/scrape/perchance_comments'; // Defina o diretório base aqui

function renameFilesInDir(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);

    // Se for um diretório, chamamos recursivamente a função
    if (stat.isDirectory()) {
      renameFilesInDir(fullPath);
    } else {
      // Verifica se o arquivo tem "_gz" no nome
      if (file.includes('_gz')) {
        const newFileName = file.replace('_gz', '.gz');
        const newFilePath = path.join(dir, newFileName);

        // Renomeia o arquivo
        fs.renameSync(fullPath, newFilePath);
        console.log(`Renomeado: ${fullPath} para ${newFilePath}`);
      }
    }
  });
}

renameFilesInDir(rootDir);
