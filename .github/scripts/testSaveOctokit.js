// Import required Node.js modules
const https = require('https');
const { Octokit } = require('@octokit/rest');


// Configurações do GitHub - Substitua estas variáveis com suas informações
const GITHUB_TOKEN = '';
const GITHUB_OWNER = 'mendoncart';
const GITHUB_REPO = 'testes';
const GITHUB_BRANCH = 'main'; // ou 'master', dependendo do seu repositório
const GITHUB_DIRECTORY = ''; // Use string vazia '' para salvar na raiz

// Inicializa o cliente Octokit com seu token
const octokit = new Octokit({
    auth: GITHUB_TOKEN
});

// Função para converter dados binários para Base64
function arrayBufferToBase64(buffer) {
    // Converte o buffer para uma string base64
    return Buffer.from(buffer).toString('base64');
}

// Função principal para baixar e salvar arquivo no GitHub
async function downloadAndSaveToGithub(fileId) {
    // Cria a URL de download
    const downloadUrl = `https://user-uploads.perchance.org/file/${fileId}`;
    
    // Define o nome do arquivo no GitHub
    const githubFilename = `${GITHUB_DIRECTORY}${fileId}`;

    try {
        // Baixa o arquivo e converte para base64
        const fileData = await new Promise((resolve, reject) => {
            https.get(downloadUrl, (response) => {
                // Verifica se o download foi bem sucedido
                if (response.statusCode !== 200) {
                    reject(new Error(`Download falhou: ${response.statusCode}`));
                    return;
                }

                // Coleta os dados do arquivo
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () => {
                    // Combina todos os chunks e converte para base64
                    const buffer = Buffer.concat(chunks);
                    resolve(arrayBufferToBase64(buffer));
                });
            }).on('error', reject);
        });

        // Tenta obter o SHA do arquivo existente (se houver)
        let fileSha;
        try {
            const existingFile = await octokit.repos.getContent({
                owner: GITHUB_OWNER,
                repo: GITHUB_REPO,
                path: githubFilename,
                ref: GITHUB_BRANCH
            });
            fileSha = existingFile.data.sha;
        } catch (error) {
            // Arquivo não existe ainda, o que é normal para novos arquivos
            fileSha = undefined;
        }

        // Prepara os dados para o commit
        const commitData = {
            owner: GITHUB_OWNER,
            repo: GITHUB_REPO,
            path: githubFilename,
            message: `Upload do arquivo ${fileId}`,
            content: fileData,
            branch: GITHUB_BRANCH
        };

        // Se o arquivo já existe, inclui o SHA para atualizá-lo
        if (fileSha) {
            commitData.sha = fileSha;
        }

        // Faz o upload do arquivo para o GitHub
        const result = await octokit.repos.createOrUpdateFileContents(commitData);
        
        console.log(`Arquivo salvo com sucesso no GitHub: ${githubFilename}`);
        return result;

    } catch (error) {
        console.error('Erro ao processar o arquivo:', error.message);
        throw error;
    }
}

// Exemplo de uso - substitua com o ID do seu arquivo
downloadAndSaveToGithub('462d8d1f91b3febeaa3e0dfb676cadfc.gz')
    .catch(error => console.error('Erro:', error));