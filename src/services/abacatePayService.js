// ============================================================
// SERVIÇO DE INTEGRAÇÃO COM ABACATEPAY
// ============================================================

const crypto = require("crypto");
const { config } = require("../config/config");

let abacateClient = null;

/**
 * Inicializa a instância do SDK AbacatePay v2 via import dinâmico (compatibilidade ESM/CommonJS).
 */
async function inicializarAbacatePay() {
    if (abacateClient) {
        return abacateClient;
    }

    try {
        const { AbacatePay } = await import("@abacatepay/sdk");
        abacateClient = AbacatePay({
            secret: config.abacatePay.apiKey
        });

        console.log("🥑 [AbacatePay] SDK v2 inicializado com sucesso.");
        return abacateClient;
    } catch (err) {
        console.error("❌ [AbacatePay] Falha ao inicializar SDK AbacatePay:", err.message);
        throw err;
    }
}

/**
 * Obtém o cliente ativo do AbacatePay.
 */
function getAbacateClient() {
    if (!abacateClient) {
        throw new Error("AbacatePay SDK ainda não foi inicializado.");
    }
    return abacateClient;
}

/**
 * Cria uma nova cobrança PIX transparente para o cliente.
 * @param {object} params
 * @param {number} params.valorReais - Valor total em reais.
 * @param {string} params.chatId - ID do chat do WhatsApp.
 * @param {object} params.cliente - Dados do cliente (nome, endereco).
 * @param {string} [params.externalId] - ID externo de referência.
 * @returns {Promise<object>} Dados do PIX criado (id, brCode, brCodeBase64, expiresAt, status).
 */
async function criarCobrancaPix({ valorReais, chatId, cliente, externalId }) {
    const client = getAbacateClient();

    if (!Number.isFinite(valorReais) || valorReais <= 0) {
        throw new Error(`Valor do pedido inválido para geração de PIX: ${valorReais}`);
    }

    const valorCentavos = Math.round(valorReais * 100);
    const idExterno = externalId || `pedido_${Date.now()}_${chatId.replace("@c.us", "")}`;

    console.log(`💳 [AbacatePay] Criando cobrança PIX de R$ ${valorReais.toFixed(2)} (${valorCentavos} centavos) para ${chatId}...`);

    const resposta = await client.pix.create({
        amount: valorCentavos,
        expiresIn: 30 * 60, // 30 minutos
        description: "Pedido Sorveteria",
        metadata: {
            chatId,
            externalId: idExterno,
            nome: cliente?.nome || "Cliente",
            endereco: cliente?.endereco || "Não informado"
        }
    });

    if (!resposta || resposta.success !== true || !resposta.data) {
        const mensagemErro = typeof resposta?.error === "string"
            ? resposta.error
            : (resposta?.error?.message || "Não foi possível gerar a cobrança PIX no AbacatePay.");

        console.error("❌ [AbacatePay] Erro ao criar PIX:", resposta?.error || resposta);
        throw new Error(mensagemErro);
    }

    const pix = resposta.data;

    if (!pix.id) {
        throw new Error("AbacatePay retornou resposta sem ID do PIX.");
    }

    if (!pix.brCode) {
        throw new Error("AbacatePay retornou resposta sem código Copia e Cola (brCode).");
    }

    console.log(`✅ [AbacatePay] PIX criado com sucesso: ${pix.id} (Status: ${pix.status || "PENDING"})`);

    return {
        id: pix.id,
        status: pix.status || "PENDING",
        brCode: pix.brCode,
        brCodeBase64: pix.brCodeBase64 || null,
        expiresAt: pix.expiresAt || null,
        externalId: idExterno
    };
}

/**
 * Valida a assinatura HMAC-SHA256 recebida no header 'x-webhook-signature'.
 * @param {string|Buffer} rawBody - Corpo bruto da requisição HTTP.
 * @param {string} assinatura - Valor do header 'x-webhook-signature'.
 * @returns {boolean} - true se a assinatura for válida e autêntica.
 */
function verificarAssinaturaWebhook(rawBody, assinatura) {
    if (!assinatura || typeof assinatura !== "string") {
        return false;
    }

    if (!config.abacatePay.publicKey) {
        console.error("❌ [AbacatePay] ABACATEPAY_PUBLIC_KEY não configurada para validação de assinatura.");
        return false;
    }

    try {
        const assinaturaEsperada = crypto
            .createHmac("sha256", config.abacatePay.publicKey)
            .update(Buffer.from(rawBody, "utf8"))
            .digest("base64");

        const bufferA = Buffer.from(assinaturaEsperada, "utf8");
        const bufferB = Buffer.from(assinatura, "utf8");

        if (bufferA.length !== bufferB.length) {
            return false;
        }

        return crypto.timingSafeEqual(bufferA, bufferB);
    } catch (err) {
        console.error("❌ [AbacatePay] Erro ao verificar assinatura HMAC:", err.message);
        return false;
    }
}

/**
 * Simula o pagamento de uma cobrança PIX (apenas modo dev/sandbox).
 * @param {string} pixId - ID do PIX (ex: pix_char_...).
 * @returns {Promise<object>}
 */
async function simularPagamentoPix(pixId) {
    const client = getAbacateClient();
    return await client.pix.simulate(pixId);
}

module.exports = {
    inicializarAbacatePay,
    getAbacateClient,
    criarCobrancaPix,
    verificarAssinaturaWebhook,
    simularPagamentoPix
};
