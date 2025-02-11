const fs = require('fs');
const path = require('path');
const { exit } = require('process');

// Defina o diretório base
const rootDir = 'ai-character-char/characters/scrape/perchance_comments';

// Função para renomear o arquivo metadata.json para capturedMessage.json
function renameMetadataFile(metadataPath) {
    const newMetadataPath = path.join(path.dirname(metadataPath), 'capturedMessage.json');
    fs.renameSync(metadataPath, newMetadataPath);
    console.log(`Renomeado ${metadataPath} para ${newMetadataPath}`);
}

// Função para criar os novos arquivos metadata.json com base nos links extraídos
function createMetadataForLinks(links, message, metadataPath) {
    links.forEach(linkData => {
        const metadata = {
            characterName: linkData.character,
            fileId: linkData.fileId,
            link: linkData.link,
            authorName: message.username || message.userNickname || message.publicId || 'Anonymous',
            authorId: message.publicId || 'Unknown'
        };

        const newMetadataPath = path.join(path.dirname(metadataPath), `metadata_${linkData.fileId}.json`);
        fs.writeFileSync(newMetadataPath, JSON.stringify(metadata, null, 2));
        console.log(`Novo metadata criado: ${newMetadataPath}`);
    });
}

// Função para extrair os links
const LINK_PATTERN = /(perchance\.org\/(.+?)\?data=(.+?)~(.+?)\.gz)/;

function extractCharacterLinks(message) {
    const links = message
        .split(/(\s+|(?<=gz),)/gm) // Mantém os espaços e ",gz" como pontos de separação.
        .filter(a => a.includes('data=')) // Filtra apenas os que têm 'data='.
        .map(a => {
            const match = a.match(LINK_PATTERN);
            if (!match) return null;

            const fullLink = match[0]; // Link completo encontrado.
            const data = fullLink.split('data=')[1]; // Extrai a parte do data do link.
            const [character, fileId] = data.split('~'); // Divide o nome do personagem e o fileId.

            return {
                character: decodeURI(character), // Decodifica o nome do personagem.
                fileId: fileId, // Armazena o ID do arquivo.
                link: `https://${fullLink.trim()}` // Constrói o link HTTPS completo.
            };
        })
        .filter(Boolean); // Remove valores nulos.

    // Remove duplicatas
    const uniqueLinks = [...new Set(links.map(JSON.stringify))].map(JSON.parse);

    return {
        links: uniqueLinks,
    };
}

// Função para processar cada subpasta
let stopProcessing = false; // Flag para controlar a interrupção

// Função para processar cada subpasta
function processMetadataInDir(dir) {
    // Se já decidimos parar, saímos imediatamente da função
    if (stopProcessing) {
        return;
    }

    fs.readdirSync(dir).forEach(file => {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        // Se for um diretório, chamamos recursivamente a função
        if (stat.isDirectory()) {
            processMetadataInDir(fullPath);
        } else {
            // Verifica se o arquivo é o metadata.json
            if (file === 'metadata.json') {
                const metadataPath = path.join(dir, file);
                const metadataContent = fs.readFileSync(metadataPath, 'utf-8');
                const metadata = JSON.parse(metadataContent);

                // Renomeia o arquivo metadata.json
                renameMetadataFile(metadataPath);

                // Extraímos os links da mensagem
                const { links } = extractCharacterLinks(metadata.message);

                if (links.length > 0) {
                    createMetadataForLinks(links, metadata, metadataPath);
                } else {
                    console.log('Nenhum link encontrado na mensagem.');
                }

                // Marca para parar o processo
                stopProcessing = true;
                console.log("Parando a execução após o primeiro arquivo.");
            }
        }
    });

    // Se necessário, podemos garantir que o processo seja finalizado
    if (stopProcessing) {
        process.exit();
    }
}

// Chama a função para processar todas as subpastas a partir do diretório raiz
processMetadataInDir(rootDir);
