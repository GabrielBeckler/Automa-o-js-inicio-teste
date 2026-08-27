// ============================================================
// CONTROLE DE IDEMPOTÊNCIA (MENSAGENS E WEBHOOKS)
// ============================================================

const mensagensProcessadas = new Map();
const TEMPO_EXPIRACAO_MENSAGEM = 5 * 60 * 1000; // 5 minutos

const eventosProcessados = new Map();
const TEMPO_EXPIRACAO_EVENTO = 60 * 60 * 1000; // 60 minutos

/**
 * Verifica se a mensagem do WhatsApp já foi processada recentemente.
 * @param {object} msg - Objeto da mensagem recebida via whatsapp-web.js.
 * @returns {boolean} - true se já foi processada, false se é nova.
 */
function mensagemJaProcessada(msg) {
    const id = msg?.id?.id;
    if (!id) {
        return false;
    }

    const agora = Date.now();

    // Limpeza de mensagens expiradas
    for (const [mensagemId, timestamp] of mensagensProcessadas) {
        if (agora - timestamp > TEMPO_EXPIRACAO_MENSAGEM) {
            mensagensProcessadas.delete(mensagemId);
        }
    }

    if (mensagensProcessadas.has(id)) {
        return true;
    }

    mensagensProcessadas.set(id, agora);
    return false;
}

/**
 * Verifica se um evento de webhook já foi processado recentemente.
 * @param {string} eventId - Identificador único do evento.
 * @returns {boolean} - true se já foi processado, false se é novo.
 */
function eventoJaProcessado(eventId) {
    if (!eventId || typeof eventId !== "string") {
        return false;
    }

    const agora = Date.now();

    // Limpeza de eventos expirados
    for (const [id, timestamp] of eventosProcessados) {
        if (agora - timestamp > TEMPO_EXPIRACAO_EVENTO) {
            eventosProcessados.delete(id);
        }
    }

    if (eventosProcessados.has(eventId)) {
        return true;
    }

    eventosProcessados.set(eventId, agora);
    return false;
}

module.exports = {
    mensagemJaProcessada,
    eventoJaProcessado
};
