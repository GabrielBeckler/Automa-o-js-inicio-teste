// ============================================================
// SERVIÇO DO WHATSAPP
// CLIENTE, EVENTOS E ENVIO DE MENSAGENS
// ============================================================

const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");

const { esperar, atrasoAleatorio } = require("../utils/helpers");

let whatsappStatus = "starting";

// ============================================================
// CLIENTE WHATSAPP
// ============================================================

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

// ============================================================
// EVENTO: QR CODE
// ============================================================

client.on("qr", qr => {
    whatsappStatus = "qr_ready";

    console.log(
        "📱 [WhatsApp] Escaneie o QR Code abaixo com seu aplicativo:"
    );

    qrcode.generate(qr, {
        small: true
    });
});

// ============================================================
// EVENTO: AUTENTICADO
// ============================================================

client.on("authenticated", () => {
    whatsappStatus = "authenticated";

    console.log(
        "🔐 [WhatsApp] Autenticação realizada com sucesso."
    );
});

// ============================================================
// EVENTO: WHATSAPP PRONTO
// ============================================================

client.on("ready", () => {

    whatsappStatus = "connected";

    console.log("================================");
    console.log(
        "🍦 [WhatsApp] Bot da Sorveteria CONECTADO e PRONTO!"
    );
    console.log("================================");

});

// ============================================================
// EVENTO: FALHA DE AUTENTICAÇÃO
// ============================================================

client.on("auth_failure", msg => {

    whatsappStatus = "auth_failure";

    console.error(
        "❌ [WhatsApp] Falha na autenticação:",
        msg
    );

});

// ============================================================
// EVENTO: DESCONECTADO
// ============================================================

client.on("disconnected", reason => {

    whatsappStatus = "disconnected";

    console.warn(
        "⚠️ [WhatsApp] Cliente desconectado. Motivo:",
        reason
    );

});

// ============================================================
// EVENTO: MUDANÇA DE ESTADO
// ============================================================

client.on("change_state", state => {

    console.log(
        `📱 [WhatsApp] Mudança de estado: ${state}`
    );

});

// ============================================================
// ENVIAR MENSAGEM
// ============================================================

/**
 * Envia uma mensagem de texto ou mídia para um chat.
 *
 * @param {string} chatId
 * @param {string|MessageMedia} conteudo
 * @param {object} opcoes
 * @returns {Promise<object>}
 */

async function enviarMensagem(
    chatId,
    conteudo,
    opcoes = {}
) {

    if (!client) {
        throw new Error(
            "Cliente WhatsApp não está inicializado."
        );
    }

    if (!chatId) {
        throw new Error(
            "Chat ID de destino não informado."
        );
    }

    if (
        whatsappStatus !== "connected"
    ) {
        throw new Error(
            `WhatsApp não está conectado. Status atual: ${whatsappStatus}`
        );
    }

    try {

        // Atraso aleatório para evitar
        // que todas as mensagens sejam enviadas
        // instantaneamente.

        const atraso =
            atrasoAleatorio(
                1000,
                2500
            );

        await esperar(atraso);

        return await client.sendMessage(
            chatId,
            conteudo,
            opcoes
        );

    } catch (err) {

        console.error(
            `❌ [WhatsApp] Erro ao enviar mensagem para ${chatId}:`,
            err.message
        );

        throw err;
    }
}

// ============================================================
// STATUS DO WHATSAPP
// ============================================================

function getWhatsAppStatus() {

    return whatsappStatus;

}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {

    client,

    enviarMensagem,

    getWhatsAppStatus,

    MessageMedia

};

