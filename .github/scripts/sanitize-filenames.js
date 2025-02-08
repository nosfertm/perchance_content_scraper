const fs = require('fs');
const path = require('path');

// Função para sanitizar strings (remove caracteres especiais e espaços)
function sanitizeString(str) {
    // Remove caracteres especiais, mantém letras, números, hífen e underscore
    return str
        .replace(/[^a-zA-Z0-9-_]/g, '_') // Substitui caracteres especiais por underscore
        .replace(/__+/g, '_')            // Remove underscores múltiplos
        .replace(/^_|_$/g, '')           // Remove underscores no início e fim
        .toLowerCase();                   // Converte para minúsculas
}

// Função para listar todas as pastas em um diretório
function listDirectories(dirPath) {
    try {
        // Lê o conteúdo do diretório e filtra apenas as pastas
        return fs.readdirSync(dirPath)
            .filter(item => fs.statSync(path.join(dirPath, item)).isDirectory());
    } catch (error) {
        console.error(`Erro ao listar diretórios em ${dirPath}:`, error);
        return [];
    }
}

// Função para listar todos os arquivos em uma pasta
function listFiles(dirPath) {
    try {
        // Lê o conteúdo do diretório e filtra apenas os arquivos
        return fs.readdirSync(dirPath)
            .filter(item => fs.statSync(path.join(dirPath, item)).isFile());
    } catch (error) {
        console.error(`Erro ao listar arquivos em ${dirPath}:`, error);
        return [];
    }
}

// Função para renomear uma pasta
function renameDirectory(oldPath, newName) {
    const dirPath = path.dirname(oldPath);
    const newPath = path.join(dirPath, newName);
    
    try {
        fs.renameSync(oldPath, newPath);
        console.log(`Pasta renomeada: ${oldPath} -> ${newPath}`);
        return newPath;
    } catch (error) {
        console.error(`Erro ao renomear pasta ${oldPath}:`, error);
        return oldPath;
    }
}

// Função para renomear um arquivo
function renameFile(dirPath, oldName) {
    const oldPath = path.join(dirPath, oldName);
    const newName = sanitizeString(oldName);
    const newPath = path.join(dirPath, newName);

    try {
        fs.renameSync(oldPath, newPath);
        console.log(`Arquivo renomeado: ${oldPath} -> ${newPath}`);
    } catch (error) {
        console.error(`Erro ao renomear arquivo ${oldPath}:`, error);
    }
}

// Função principal que coordena todo o processo
function sanitizeAll(basePath) {
    console.log('Iniciando processo de sanitização...');
    
    // Lista todas as pastas no diretório base
    const directories = listDirectories(basePath);
    console.log(`Encontradas ${directories.length} pastas para processar`);

    // Processa cada pasta
    directories.forEach(dir => {
        const fullDirPath = path.join(basePath, dir);
        console.log(`\nProcessando pasta: ${dir}`);

        // Sanitiza e renomeia a pasta atual
        const newDirName = sanitizeString(dir);
        const newDirPath = renameDirectory(fullDirPath, newDirName);

        // Lista e processa os arquivos dentro da pasta
        const files = listFiles(newDirPath);
        console.log(`Encontrados ${files.length} arquivos em ${newDirPath}`);

        // Renomeia cada arquivo
        files.forEach(file => {
            renameFile(newDirPath, file);
        });
    });

    console.log('\nProcesso de sanitização concluído!');
}

// Executa o script
const basePath = 'ai-character-char/characters/scrape/perchance_comments';
sanitizeAll(basePath);
