// ============================================================
// SERVIDOR EXPRESS (ROTAS WEBHOOK, HEALTHCHECK E MIDDLEWARES)
// ============================================================

const express = require("express");
const { config } = require("../config/config");
const { handleAbacatePayWebhook } = require("../handlers/webhookHandler");
const { getWhatsAppStatus } = require("../services/whatsappService");

const app = express();

// ============================================================
// ROTA DO WEBHOOK ABACATEPAY
// express.raw() é obrigatório para validação da assinatura HMAC
// ============================================================
app.post(
    "/webhooks/abacatepay",
    express.raw({
        type: "application/json"
    }),
    handleAbacatePayWebhook
);

// ============================================================
// HEALTH CHECK
// ============================================================
app.get("/", (req, res) => {
    res.json({
        status: "online",
        bot: "sorveteria",
        whatsapp: getWhatsAppStatus()
    });
});

// ============================================================
// TRATAMENTO DE ERROS DO EXPRESS
// ============================================================
app.use((err, req, res, next) => {
    console.error("❌ [Express] Erro interno capturado pelo middleware:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        error: "Internal server error"
    });
});

/**
 * Inicia o servidor HTTP Express.
 * @param {number} [porta=config.server.port]
 * @returns {Promise<import("http").Server>}
 */
function iniciarServidor(porta = config.server.port) {
    return new Promise((resolve) => {
        const server = app.listen(porta, () => {
            console.log("🌐 [Express] Servidor Webhook online em:");
            console.log(`   http://localhost:${porta}`);
            console.log(`   POST http://localhost:${porta}/webhooks/abacatepay`);
            resolve(server);
        });
    });
}

module.exports = {
    app,
    iniciarServidor
};
