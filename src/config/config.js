// ============================================================
// CONFIGURAÇÃO DO BOT E VARIÁVEIS DE AMBIENTE
// ============================================================

require("dotenv").config();

const path = require("path");
const fs = require("fs");

const config = {
    store: {
        numero: process.env.NUMERO_LOJA,
        chavePix: process.env.CHAVE_PIX || null
    },
    abacatePay: {
        apiKey: process.env.ABACATEPAY_API_KEY,
        webhookSecret: process.env.ABACATEPAY_WEBHOOK_SECRET,
        publicKey: process.env.ABACATEPAY_PUBLIC_KEY
    },
    server: {
        port: Number(process.env.PORT) || 3000
    },
    database: {
        host: process.env.DB_HOST || "localhost",
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        name: process.env.DB_NAME
    },
    whatsapp: {
        numeroPedidos: process.env.NUMERO_PEDIDOS
    },
    paths: {
        caminhoMenu: path.resolve(
            process.cwd(),
            process.env.CAMINHO_MENU || "img/menu/menu.png"
        )
    }
};

/**
 * Valida se todas as variáveis de ambiente essenciais foram configuradas.
 * Lança erro descritivo caso alguma esteja ausente ou em formato inválido.
 */
function validarConfiguracao() {
    if (!config.store.numero) {
        throw new Error("Configuração ausente: NUMERO_LOJA não foi configurado no .env");
    }

    if (!/^\d+$/.test(config.store.numero)) {
        throw new Error("Configuração inválida: NUMERO_LOJA deve conter apenas dígitos numéricos.");
    }

    if (!config.abacatePay.apiKey || config.abacatePay.apiKey.trim() === "") {
        throw new Error("Configuração ausente: ABACATEPAY_API_KEY não foi configurada no .env");
    }

    if (!config.abacatePay.webhookSecret || config.abacatePay.webhookSecret.trim() === "") {
        throw new Error("Configuração ausente: ABACATEPAY_WEBHOOK_SECRET não foi configurado no .env");
    }

    if (!config.abacatePay.publicKey || config.abacatePay.publicKey.trim() === "") {
        throw new Error("Configuração ausente: ABACATEPAY_PUBLIC_KEY não foi configurada no .env");
    }

    if (!config.whatsapp.numeroPedidos) {
        throw new Error("Configuração ausente: NUMERO_PEDIDOS não foi configurado no .env");
    }

    for (const [nome, valor] of Object.entries({
        DB_USER: config.database.user,
        DB_PASSWORD: config.database.password,
        DB_NAME: config.database.name
    })) {
        if (!valor || String(valor).trim() === "") {
            throw new Error(`Configuração ausente: ${nome} não foi configurado no .env`);
        }
    }
}

/**
 * Verifica a existência do arquivo de imagem do cardápio.
 */
function verificarCardapio() {
    if (!fs.existsSync(config.paths.caminhoMenu)) {
        console.warn("⚠️ [Config] Imagem do cardápio não encontrada no caminho:", config.paths.caminhoMenu);
        console.warn("ℹ️ [Config] O bot continuará operando utilizando o cardápio em formato de texto.");
        return false;
    }

    console.log("📋 [Config] Cardápio em imagem localizado com sucesso:", config.paths.caminhoMenu);
    return true;
}

module.exports = {
    config,
    validarConfiguracao,
    verificarCardapio
};
