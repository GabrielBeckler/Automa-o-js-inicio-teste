// ============================================================
// FUNÇÕES AUXILIARES / HELPERS
// ============================================================

/**
 * Pausa a execução assíncrona por um tempo determinado.
 * @param {number} ms - Tempo em milissegundos.
 * @returns {Promise<void>}
 */
function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Gera um atraso aleatório dentro de um intervalo.
 * @param {number} min - Mínimo em ms.
 * @param {number} max - Máximo em ms.
 * @returns {number}
 */
function atrasoAleatorio(min = 1000, max = 2500) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Extrai o número limpo do chatId do WhatsApp.
 * @param {string} chatId - ID do chat (ex: 553199999999@c.us).
 * @returns {string}
 */
function extrairNumeroWhatsApp(chatId) {
    if (!chatId || typeof chatId !== "string") return "";
    return chatId.replace(/@c\.us|@g\.us|@lid|@s\.whatsapp\.net/g, "");
}

module.exports = {
    esperar,
    atrasoAleatorio,
    extrairNumeroWhatsApp
};
