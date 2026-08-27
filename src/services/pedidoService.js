// ============================================================
// SERVIÇO DE PROCESSAMENTO E DESPACHO DE PEDIDOS
// ============================================================

const { config } = require("../config/config");

const {
    enviarMensagem,
} = require("./whatsappService");

const {
    formatarMensagemPedido,
    totalPedido,
    resumoPedido,
    formatarMoeda
} = require("../utils/formatadores");

const {
    ESTADOS
} = require("../state/sessionManager");

// ============================================================
// ENVIAR PEDIDO PARA GRUPO
// ============================================================

async function enviarPedidoParaNumero(
    sessao,
    chatId,
    status = "PREPARANDO"
) {
    const mensagem =
        formatarMensagemPedido(
            sessao,
            chatId,
            status
        );

    const numero =
        config.whatsapp.numeroPedidos
            .replace(/\D/g, "");

    if (!numero) {
        throw new Error(
            "NUMERO_PEDIDOS inválido."
        );
    }

    const destino =
        `${numero}@c.us`;

    console.log(
        `📤 [Pedido] Enviando pedido para ${destino}...`
    );

    try {
        await enviarMensagem(
            destino,
            mensagem
        );

        console.log(
            `✅ [Pedido] Pedido enviado para ${destino}.`
        );

        return {
            sucesso: true,
            destino
        };

    } catch (err) {
        console.error(
            "❌ [Pedido] Erro ao enviar pedido:",
            err.message
        );

        return {
            sucesso: false,
            erro: err.message
        };
    }
}

// ============================================================
// NOTIFICAR CLIENTE — PIX
// ============================================================

async function notificarClientePagamentoConfirmado(
    chatId,
    sessao
) {
    const mensagem =
        "✅ *Pagamento confirmado!*\n\n" +
        "Seu pagamento foi recebido com sucesso. 💳\n\n" +
        "🍦 Seu pedido foi enviado para nossa equipe e já está sendo preparado!\n\n" +
        "Em breve estará pronto para você. ❤️";

    await enviarMensagem(
        chatId,
        mensagem
    );
}

// ============================================================
// NOTIFICAR CLIENTE — PAGAMENTO NA ENTREGA
// ============================================================

async function notificarClientePedidoNaEntrega(
    chatId,
    sessao
) {
    const c =
        sessao.cliente || {};

    const total =
        totalPedido(
            sessao.pedido
        );

    const mensagem =
        "✅ *Pedido confirmado!*\n\n" +
        resumoPedido(
            sessao.pedido
        ) +
        "\n\n" +
        `*Total: ${formatarMoeda(total)}*\n` +
        `Pagamento: ${c.pagamento || "Pagamento na entrega"}\n\n` +
        `Obrigado, ${c.nome || "Cliente"}! ❤️\n\n` +
        "Já estamos preparando seu pedido. 🍦";

    await enviarMensagem(
        chatId,
        mensagem
    );
}

// ============================================================
// DESPACHAR PEDIDO CONFIRMADO
// ============================================================

async function despacharPedidoConfirmado({
    sessao,
    chatId,
    status = "PREPARANDO",
    isPix = true
}) {

    // ========================================================
    // PROTEÇÃO CONTRA DUPLICIDADE
    // ========================================================

    if (sessao.pedidoEnviadoParaNumero) {
    console.log(
        `⚠️ [Pedido] Pedido de ${chatId} já foi enviado.`
    );

    return true;
}
    // ========================================================
    // ENVIAR PEDIDO
    // ========================================================

    const resultadoEnvio =
    await enviarPedidoParaNumero(
        sessao,
        chatId,
        status
    );

    // ========================================================
    // SE NÃO CONSEGUIU ENVIAR
    // ========================================================

    if (
        !resultadoEnvio.sucesso
    ) {
        const erroMsg =
            `Falha ao despachar pedido: ${resultadoEnvio.erro}`;

        console.error(
            `❌ [Pedido] ${erroMsg}`
        );

        throw new Error(
            erroMsg
        );
    }

    // ========================================================
    // MARCAR COMO ENVIADO
    // ========================================================

    sessao.pedidoEnviadoParaNumero =
        true;

    // ========================================================
    // STATUS DO PEDIDO
    // ========================================================

    sessao.statusPedido =
        "PREPARANDO";

    // ========================================================
    // NOTIFICAR CLIENTE
    // ========================================================

    if (isPix) {

        await notificarClientePagamentoConfirmado(
            chatId,
            sessao
        );

    } else {

        await notificarClientePedidoNaEntrega(
            chatId,
            sessao
        );
    }

    // ========================================================
    // FINALIZAR ATENDIMENTO
    // ========================================================

    sessao.pedidoFinalizado =
        true;

    sessao.etapa =
        ESTADOS.FINALIZADO;

    console.log(
        `🎉 [Pedido] Pedido finalizado para ${sessao.cliente?.nome || "cliente"} (${chatId}).`
    );

    return true;
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    enviarPedidoParaNumero,
    notificarClientePagamentoConfirmado,
    notificarClientePedidoNaEntrega,
    despacharPedidoConfirmado
};