const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Array para armazenar os caminhos que falharam
const failedPaths = [];

// Função para calcular hash do conteúdo de um arquivo
function calculateFileHash(filePath) {
    try {
        const content = fs.readFileSync(filePath);
        return crypto.createHash('md5').update(content).digest('hex');
    } catch (error) {
        console.error(`Erro ao calcular hash do arquivo ${filePath}:`, error);
        return null;
    }
}

// Função para comparar conteúdo de duas pastas
function compareDirectories(dir1, dir2) {
    try {
        // Lista arquivos em ambas as pastas
        const files1 = fs.readdirSync(dir1).filter(item => fs.statSync(path.join(dir1, item)).isFile());
        const files2 = fs.readdirSync(dir2).filter(item => fs.statSync(path.join(dir2, item)).isFile());

        // Se número de arquivos é diferente, pastas são diferentes
        if (files1.length !== files2.length) {
            return {
                identical: false,
                reason: `Número diferente de arquivos: ${dir1}(${files1.length}) vs ${dir2}(${files2.length})`
            };
        }

        // Compara cada arquivo
        for (const file of files1) {
            const file1Path = path.join(dir1, file);
            const file2Path = path.join(dir2, file);

            // Se arquivo não existe na segunda pasta
            if (!fs.existsSync(file2Path)) {
                return {
                    identical: false,
                    reason: `Arquivo ${file} não existe em ${dir2}`
                };
            }

            // Compara conteúdo dos arquivos
            const hash1 = calculateFileHash(file1Path);
            const hash2 = calculateFileHash(file2Path);

            if (hash1 !== hash2) {
                return {
                    identical: false,
                    reason: `Conteúdo diferente no arquivo ${file}`
                };
            }
        }

        return { identical: true };
    } catch (error) {
        console.error(`Erro ao comparar diretórios:`, error);
        return {
            identical: false,
            reason: `Erro ao comparar: ${error.message}`
        };
    }
}

// Função para sanitizar strings (mantida a mesma)
function sanitizeString(str) {
    if (!str) return 'unnamed';

    return str
        .normalize('NFKD')                          // Normalize Unicode to decompose accented characters
        .replace(/[\u0300-\u036f]/g, '')              // Remove diacritical marks (accents)
        .replace(/[\p{C}\p{Zl}\p{Zp}\p{Cf}]+/gu, '')  // Remove control characters, invisible characters, and formatting characters
        .replace(/[\/\\:*?"<>|#@!%^&=`[\]{}$;,+]+/g, '') // Remove problematic characters for OS, URLs, and databases
        .replace(/[^a-zA-Z0-9\p{L}\p{M}\p{N} _\-.,'()~]/gu, '') // Keep safe characters for OS and web
        .replace(/\s{2,}/g, ' ')                     // Replace multiple spaces with a single space
        .replace(/_{2,}/g, '_')                      // Replace multiple underscores with a single one
        .replace(/^[-_ ]+|[-_ ]+$/g, '')             // Trim leading/trailing underscores, dashes, and spaces
        .trim();                                     // Trim spaces at the beginning and end
}


// Função para listar todas as pastas em um diretório
function listDirectories(dirPath) {
    try {
        return fs.readdirSync(dirPath)
            .filter(item => fs.statSync(path.join(dirPath, item)).isDirectory());
    } catch (error) {
        console.error(`Erro ao listar diretórios em ${dirPath}:`, error);
        return [];
    }
}

// Função para tratar a renomeação com verificação de duplicatas
async function handleDirectoryRename(oldPath, newName) {
    const dirPath = path.dirname(oldPath);
    const newPath = path.join(dirPath, newName);

    // Se o nome não mudou, não faz nada
    if (oldPath === newPath) return { success: true, path: oldPath };

    console.log(`\nAnalisando: ${oldPath} -> ${newName}`);

    // Verifica se o destino já existe
    if (fs.existsSync(newPath)) {
        console.log('Pasta com nome sanitizado já existe. Comparando conteúdo...');
        const comparison = compareDirectories(oldPath, newPath);

        if (comparison.identical) {
            console.log('Conteúdo idêntico encontrado. Deletando pasta original...');
            try {
                fs.rmdirSync(oldPath, { recursive: true });
                console.log('Pasta original deletada com sucesso!');
                return { success: true, path: newPath };
            } catch (error) {
                console.error('Erro ao deletar pasta original:', error);
                failedPaths.push({
                    oldPath,
                    newPath,
                    error: 'Erro ao deletar pasta original: ' + error.message,
                    type: 'deletion_error',
                    identical: true
                });
                return { success: false, path: oldPath };
            }
        } else {
            console.log('Conteúdo diferente encontrado!');
            failedPaths.push({
                oldPath,
                newPath,
                error: 'Pasta com mesmo nome existe com conteúdo diferente',
                reason: comparison.reason,
                type: 'content_different'
            });
            return { success: false, path: oldPath };
        }
    }

    // Se não existe, tenta renomear
    try {
        fs.renameSync(oldPath, newPath);
        console.log('Pasta renomeada com sucesso!');
        return { success: true, path: newPath };
    } catch (error) {
        console.error('Erro ao renomear:', error);
        failedPaths.push({
            oldPath,
            newPath,
            error: error.message,
            type: 'rename_error'
        });
        return { success: false, path: oldPath };
    }
}

// Função principal
async function sanitizeAll(basePath) {
    console.log('Iniciando processo de sanitização...');
    
    const directories = listDirectories(basePath); //.slice(0, 100)
    console.log(`Encontradas ${directories.length} pastas para processar`);

    for (const dir of directories) {
        const fullDirPath = path.join(basePath, dir);
        const newDirName = sanitizeString(dir);
        await handleDirectoryRename(fullDirPath, newDirName);
    }

    // Gera o relatório de falhas
    if (failedPaths.length > 0) {
        const logPath = path.join(basePath, 'failed_renames.json');
        await fs.promises.writeFile(
            logPath,
            JSON.stringify(failedPaths, null, 2),
            'utf8'
        );
        console.log(`\n${failedPaths.length} operações requerem atenção.`);
        console.log(`Log detalhado salvo em: ${logPath}`);

        // Contagem por tipo de falha
        const countByType = failedPaths.reduce((acc, curr) => {
            acc[curr.type] = (acc[curr.type] || 0) + 1;
            return acc;
        }, {});
        console.log('\nResumo das falhas:');
        console.log(countByType);
    }

    console.log('\nProcesso de sanitização concluído!');
}

// Executa o script
const basePath = 'ai-character-char/characters/scrape/perchance_comments';
sanitizeAll(basePath).catch(error => {
    console.error('Erro durante a sanitização:', error);
});