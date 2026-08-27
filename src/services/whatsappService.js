// ============================================================
// SERVIÇO DO WHATSAPP (CLIENTE, EVENTOS E ENVIO DE MENSAGENS)
// ============================================================

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { config } = require("../config/config");
const { esperar, atrasoAleatorio } = require("../utils/helpers");

let whatsappStatus = "starting";

const client = new Client({
    authStrategy: new LocalAuth({
        dataPath: ".wwebjs_auth"
    }),
    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-accelerated-2d-canvas",
            "--no-first-run",
            "--no-zygote",
            "--disable-gpu"
        ]
    }
});

// Configuração dos Eventos do WhatsApp
client.on("qr", qr => {
    whatsappStatus = "qr_ready";
    console.log("📱 [WhatsApp] Escaneie o QR Code abaixo com seu aplicativo:");
    qrcode.generate(qr, { small: true });
});

client.on("authenticated", () => {
    whatsappStatus = "authenticated";
    console.log("🔐 [WhatsApp] Autenticação realizada com sucesso.");
});

client.on("ready", () => {
    whatsappStatus = "connected";
    console.log("================================");
    console.log("🍦 [WhatsApp] Bot da Sorveteria CONECTADO e PRONTO!");
    console.log("================================");
});

client.on("auth_failure", msg => {
    whatsappStatus = "auth_failure";
    console.error("❌ [WhatsApp] Falha na autenticação:", msg);
});

client.on("disconnected", reason => {
    whatsappStatus = "disconnected";
    console.warn("⚠️ [WhatsApp] Cliente desconectado. Motivo:", reason);
});

client.on("change_state", state => {
    console.log(`📱 [WhatsApp] Mudança de estado: ${state}`);
});

/**
 * Envia uma mensagem de texto ou mídia para um chat de forma segura com atraso humano.
 * @param {string} chatId - Destinatário (ex: 553199999999@c.us ou ID do grupo).
 * @param {string|MessageMedia} conteudo - Texto ou Mídia.
 * @param {object} [opcoes={}] - Opções do sendMessage (ex: caption).
 * @returns {Promise<object>}
 */
async function enviarMensagem(chatId, conteudo, opcoes = {}) {
    if (!client) {
        throw new Error("Cliente WhatsApp não está inicializado.");
    }

    if (!chatId) {
        throw new Error("Chat ID de destino não informado.");
    }

    try {
        // Atraso aleatório entre 1.0s e 2.5s para emular digitação humana
        const atraso = atrasoAleatorio(1000, 2500);
        await esperar(atraso);

        return await client.sendMessage(chatId, conteudo, opcoes);
    } catch (err) {
        console.error(`❌ [WhatsApp] Erro ao enviar mensagem para ${chatId}:`, err.message);
        throw err;
    }
}

/**
 * Localiza dinamicamente o grupo do WhatsApp pelo nome.
 * Trata casos de múltiplos grupos com mesmo nome ou grupo não encontrado.
 * @param {string} [nomeGrupo] - Nome do grupo (Padrão: config.whatsapp.grupoPedidosNome).
 * @returns {Promise<object|null>} Chat do grupo ou null se não encontrado.
 */
async function encontrarGrupoPedidos(nomeGrupo = config.whatsapp.grupoPedidosNome) {
    try {
        if (!client || whatsappStatus !== "connected") {
            console.warn("⚠️ [WhatsApp] Não é possível buscar chats: cliente WhatsApp ainda não conectado.");
            return null;
        }

        const chats = await client.getChats();
        const nomeAlvo = nomeGrupo.trim().toLowerCase();

        const gruposEncontrados = chats.filter(
            chat => chat.isGroup && chat.name && chat.name.trim().toLowerCase() === nomeAlvo
        );

        if (gruposEncontrados.length === 0) {
            console.error(`❌ [WhatsApp] Grupo de pedidos com nome "${nomeGrupo}" não foi encontrado.`);
            console.error("ℹ️ [WhatsApp] Certifique-se de que o bot foi adicionado ao grupo no WhatsApp.");
            return null;
        }

        // Se houver mais de um grupo com o mesmo nome
        if (gruposEncontrados.length > 1) {
            console.warn(`⚠️ [WhatsApp] Foram encontrados ${gruposEncontrados.length} grupos com o nome "${nomeGrupo}":`);
            gruposEncontrados.forEach((g, idx) => {
                console.warn(`   [${idx + 1}] ID: ${g.id._serialized} | Nome: "${g.name}"`);
            });

            // Se um ID específico foi configurado no .env, utiliza-o para desambiguação
            if (config.whatsapp.grupoPedidosId) {
                const grupoEspecifico = gruposEncontrados.find(
                    g => g.id._serialized === config.whatsapp.grupoPedidosId
                );
                if (grupoEspecifico) {
                    console.log(`✅ [WhatsApp] Usando grupo especificado via ID_GRUPO_PEDIDOS: ${grupoEspecifico.id._serialized}`);
                    return grupoEspecifico;
                }
                console.error(`❌ [WhatsApp] ID_GRUPO_PEDIDOS configurado (${config.whatsapp.grupoPedidosId}) não corresponde a nenhum dos grupos.`);
            }

            console.warn(`⚠️ [WhatsApp] Utilizando o primeiro grupo encontrado (${gruposEncontrados[0].id._serialized}). Configure ID_GRUPO_PEDIDOS no .env se desejar fixar.`);
        }

        return gruposEncontrados[0];
    } catch (err) {
        console.error("❌ [WhatsApp] Erro ao pesquisar grupos no WhatsApp:", err.message);
        return null;
    }
}

/**
 * Retorna o status atual da conexão do WhatsApp.
 * @returns {string}
 */
function getWhatsAppStatus() {
    return whatsappStatus;
}

module.exports = {
    client,
    enviarMensagem,
    encontrarGrupoPedidos,
    getWhatsAppStatus,
    MessageMedia
};
