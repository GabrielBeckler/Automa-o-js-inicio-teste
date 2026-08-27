// ============================================================
// SERVIÇO DE PROCESSAMENTO E DESPACHO DE PEDIDOS
// ============================================================

const { config } = require("../config/config");
const { enviarMensagem, encontrarGrupoPedidos } = require("./whatsappService");
const { formatarMensagemGrupoPedidos, totalPedido, resumoPedido, formatarMoeda } = require("../utils/formatadores");
const { ESTADOS } = require("../state/sessionManager");

/**
 * Envia o resumo formatado do pedido para o grupo "pedidos" do WhatsApp.
 * Se o grupo não for localizado, realiza tentativa de envio direto ao número da loja.
 * @param {object} sessao - Sessão do cliente.
 * @param {string} chatId - ID do chat do WhatsApp.
 * @param {string} [status="PREPARANDO"] - Status a ser exibido.
 * @returns {Promise<{ sucesso: boolean, grupoId?: string, erro?: string }>}
 */
async function enviarPedidoParaGrupo(sessao, chatId, status = "PREPARANDO") {
    const mensagemGrupo = formatarMensagemGrupoPedidos(sessao, chatId, status);

    // 1. Tentar localizar o grupo "pedidos"
    const grupo = await encontrarGrupoPedidos(config.whatsapp.grupoPedidosNome);

    if (grupo && grupo.id && grupo.id._serialized) {
        console.log(`📤 [Pedido] Enviando pedido para o grupo "${grupo.name}" (${grupo.id._serialized})...`);
        await enviarMensagem(grupo.id._serialized, mensagemGrupo);
        console.log(`✅ [Pedido] Pedido enviado com sucesso ao grupo "${grupo.name}".`);
        return { sucesso: true, grupoId: grupo.id._serialized };
    }

    // 2. Se o grupo não existir, registrar erro crítico e tentar enviar para o número individual da loja como contingência
    console.error(`❌ [Pedido] CRÍTICO: Grupo "${config.whatsapp.grupoPedidosNome}" não encontrado.`);

    if (config.store.numero) {
        const chatLoja = `${config.store.numero}@c.us`;
        console.warn(`⚠️ [Pedido] Tentando envio de contingência diretamente para a loja (${chatLoja})...`);
        try {
            await enviarMensagem(chatLoja, mensagemGrupo);
            console.log(`✅ [Pedido] Pedido entregue na contingência para ${chatLoja}.`);
            return { sucesso: true, grupoId: chatLoja, contingencia: true };
        } catch (errLoja) {
            console.error(`❌ [Pedido] Falha também no envio de contingência para a loja:`, errLoja.message);
        }
    }

    return {
        sucesso: false,
        erro: `Grupo "${config.whatsapp.grupoPedidosNome}" não encontrado e contingência indisponível.`
    };
}

/**
 * Notifica o cliente que o pagamento PIX foi confirmado e o pedido está sendo preparado.
 * @param {string} chatId
 * @param {object} sessao
 */
async function notificarClientePagamentoConfirmado(chatId, sessao) {
    const mensagem =
        "✅ *Pagamento confirmado!*\n\n" +
        "Seu pagamento foi recebido com sucesso. 💳\n\n" +
        "🍦 Seu pedido foi enviado para nossa equipe e já está sendo preparado!\n\n" +
        "Em breve estará pronto para você. ❤️";

    await enviarMensagem(chatId, mensagem);
}

/**
 * Notifica o cliente para pagamentos com opção na entrega.
 * @param {string} chatId
 * @param {object} sessao
 */
async function notificarClientePedidoNaEntrega(chatId, sessao) {
    const c = sessao.cliente || {};
    const total = totalPedido(sessao.pedido);

    const mensagem =
        "✅ *Pedido confirmado!*\n\n" +
        resumoPedido(sessao.pedido) + "\n\n" +
        `*Total: ${formatarMoeda(total)}*\n` +
        `Pagamento: ${c.pagamento || "Pagamento na entrega"}\n\n` +
        `Obrigado, ${c.nome || "Cliente"}! ❤️\n\n` +
        "Já estamos preparando seu pedido. 🍦";

    await enviarMensagem(chatId, mensagem);
}

/**
 * Orquestra o ciclo completo de confirmação do pedido:
 * 1. Verifica duplicidade (se já foi enviado ao grupo).
 * 2. Envia ao grupo "pedidos".
 * 3. Se sucesso: atualiza status para PREPARANDO, notifica cliente e finaliza.
 * 4. Se falha: lança erro e preserva o estado sem finalizar.
 *
 * @param {object} params
 * @param {object} params.sessao - Sessão do cliente.
 * @param {string} params.chatId - ID do chat.
 * @param {string} [params.status="PREPARANDO"]
 * @param {boolean} [params.isPix=true]
 * @returns {Promise<boolean>}
 */
async function despacharPedidoConfirmado({ sessao, chatId, status = "PREPARANDO", isPix = true }) {
    // Prevenção de duplicidade: não reenvia se já foi despachado
    if (sessao.pedidoEnviadoParaGrupo) {
        console.log(`⚠️ [Pedido] Pedido de ${chatId} já foi enviado ao grupo anteriormente. Ignorando reenvio.`);
        return true;
    }

    // 1. Enviar ao grupo "pedidos"
    const resultadoEnvio = await enviarPedidoParaGrupo(sessao, chatId, status);

    if (!resultadoEnvio.sucesso) {
        const erroMsg = `Falha ao despachar pedido para o grupo: ${resultadoEnvio.erro}`;
        console.error(`❌ [Pedido] ${erroMsg} (chatId: ${chatId})`);
        throw new Error(erroMsg);
    }

    // 2. Atualizar estados da sessão
    sessao.pedidoEnviadoParaGrupo = true;
    sessao.etapa = ESTADOS.PREPARANDO;

    // 3. Notificar o cliente
    if (isPix) {
        await notificarClientePagamentoConfirmado(chatId, sessao);
    } else {
        await notificarClientePedidoNaEntrega(chatId, sessao);
    }

    // 4. Finalizar atendimento
    sessao.pedidoFinalizado = true;
    sessao.etapa = ESTADOS.FINALIZADO;

    console.log(`🎉 [Pedido] Pedido finalizado com sucesso para o cliente ${sessao.cliente?.nome} (${chatId}).`);
    return true;
}

module.exports = {
    enviarPedidoParaGrupo,
    notificarClientePagamentoConfirmado,
    notificarClientePedidoNaEntrega,
    despacharPedidoConfirmado
};
