// ============================================================
// GERENCIADOR DE SESSÕES E ESTADO DOS CLIENTES
// ============================================================

const ESTADOS = Object.freeze({
    INICIO: "inicio",
    PEDIDO: "pedido",
    QUANTIDADE: "quantidade",
    NOME: "nome",
    ANIVERSARIO: "aniversario",
    ENDERECO: "endereco",
    PAGAMENTO: "pagamento",
    AGUARDANDO_PIX: "aguardando_pix",
    PAGAMENTO_CONFIRMADO: "pagamento_confirmado",
    PREPARANDO: "preparando",
    FINALIZADO: "finalizado"
});

// Mapa de sessões: chatId -> Objeto de Sessão
const sessoes = new Map();

// Mapa de pagamentos pendentes: paymentId -> chatId
const pagamentosPendentes = new Map();

/**
 * Cria a estrutura inicial para uma nova sessão de atendimento.
 * @returns {object}
 */
function criarEstruturaSessao() {
    return {
        etapa: ESTADOS.INICIO,
        pedido: [],
        cliente: {
            nome: null,
            aniversario: null,
            endereco: null,
            pagamento: null
        },
        itemPendente: null,
        pagamento: {
            id: null,
            status: null,
            brCode: null,
            brCodeBase64: null,
            expiresAt: null
        },
        pedidoEnviadoParaGrupo: false,
        pedidoFinalizado: false,
        criadoEm: Date.now(),
        atualizadoEm: Date.now()
    };
}

/**
 * Obtém a sessão atual de um chatId ou cria uma nova se não existir.
 * @param {string} chatId
 * @returns {object}
 */
function getSessao(chatId) {
    if (!sessoes.has(chatId)) {
        sessoes.set(chatId, criarEstruturaSessao());
    }
    const sessao = sessoes.get(chatId);
    sessao.atualizadoEm = Date.now();
    return sessao;
}

/**
 * Reseta a sessão de um cliente para o estado inicial.
 * @param {string} chatId
 * @returns {object} Nova sessão
 */
function resetarSessao(chatId) {
    const nova = criarEstruturaSessao();
    sessoes.set(chatId, nova);
    return nova;
}

/**
 * Vincula um ID de cobrança PIX ao chatId do cliente.
 * @param {string} paymentId - ID da cobrança (ex: pix_char_...).
 * @param {string} chatId - ID do chat WhatsApp.
 */
function vincularPagamento(paymentId, chatId) {
    if (paymentId && chatId) {
        pagamentosPendentes.set(paymentId, chatId);
    }
}

/**
 * Localiza o chatId associado a um pagamento por meio do mapa pendente
 * ou varredura de fallback nas sessões ativas.
 * @param {string} paymentId - ID da cobrança.
 * @returns {string|null} - chatId ou null se não encontrado.
 */
function obterChatPorPagamento(paymentId) {
    if (!paymentId) return null;

    // 1. Busca direta no mapa rápido
    if (pagamentosPendentes.has(paymentId)) {
        return pagamentosPendentes.get(paymentId);
    }

    // 2. Fallback: busca por correspondência em todas as sessões
    for (const [chatId, sessao] of sessoes.entries()) {
        if (sessao.pagamento && sessao.pagamento.id === paymentId) {
            return chatId;
        }
    }

    return null;
}

/**
 * Remove a cobrança do mapa de pendentes após finalização.
 * @param {string} paymentId
 */
function removerPagamentoPendente(paymentId) {
    if (paymentId) {
        pagamentosPendentes.delete(paymentId);
    }
}

module.exports = {
    ESTADOS,
    getSessao,
    resetarSessao,
    vincularPagamento,
    obterChatPorPagamento,
    removerPagamentoPendente
};
