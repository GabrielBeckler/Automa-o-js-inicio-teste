// ============================================================
// FORMATADORES E CÁLCULOS DO PEDIDO
// ============================================================

const { extrairNumeroWhatsApp } = require("./helpers");

/**
 * Calcula o valor total do pedido somando os itens válidos.
 * @param {Array<object>} pedido - Lista de itens do pedido.
 * @returns {number} - Total calculado em reais.
 */
function totalPedido(pedido) {
    if (!Array.isArray(pedido)) {
        return 0;
    }

    return pedido.reduce((soma, item) => {
        const preco = Number(item.preco);
        const quantidade = Number(item.quantidade);

        if (!Number.isFinite(preco) || !Number.isFinite(quantidade)) {
            return soma;
        }

        return soma + preco * quantidade;
    }, 0);
}

/**
 * Gera o resumo dos itens do pedido em formato legível com marcadores.
 * @param {Array<object>} pedido - Lista de itens do pedido.
 * @returns {string} - Lista formatada em texto.
 */
function resumoPedido(pedido) {
    if (!Array.isArray(pedido) || pedido.length === 0) {
        return "Nenhum item no pedido.";
    }

    return pedido
        .map(item => {
            const subtotal = Number(item.preco) * Number(item.quantidade);
            return `- ${item.quantidade}x ${item.nome} (R$ ${subtotal.toFixed(2)})`;
        })
        .join("\n");
}

/**
 * Formata um valor numérico para o padrão de moeda brasileiro (R$ 0,00).
 * @param {number} valor - Valor em reais.
 * @returns {string}
 */
function formatarMoeda(valor) {
    const num = Number(valor);
    if (!Number.isFinite(num)) return "R$ 0.00";
    return `R$ ${num.toFixed(2)}`;
}

/**
 * Monta a mensagem padrão enviada ao grupo "pedidos" após a confirmação.
 * @param {object} sessao - Objeto da sessão do cliente.
 * @param {string} chatId - ID do chat do WhatsApp.
 * @param {string} status - Status do pedido (Padrão: "PREPARANDO").
 * @returns {string} - Mensagem formatada.
 */
function formatarMensagemGrupoPedidos(sessao, chatId, status = "PREPARANDO") {
    const c = sessao.cliente || {};
    const total = totalPedido(sessao.pedido);
    const numeroCliente = extrairNumeroWhatsApp(chatId);

    return (
        "🍦 *NOVO PEDIDO*\n\n" +
        `Cliente: ${c.nome || "Não informado"}\n` +
        `WhatsApp: ${numeroCliente}\n` +
        `Aniversário: ${c.aniversario || "não informado"}\n` +
        `Endereço: ${c.endereco || "Não informado"}\n` +
        `Pagamento: ${c.pagamento || "PIX"}\n` +
        `Status: ${status}\n\n` +
        "Itens:\n" +
        resumoPedido(sessao.pedido) + "\n\n" +
        `*Total: ${formatarMoeda(total)}*`
    );
}

module.exports = {
    totalPedido,
    resumoPedido,
    formatarMoeda,
    formatarMensagemGrupoPedidos
};
