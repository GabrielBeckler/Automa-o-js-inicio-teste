// ============================================================
// HANDLER DO WEBHOOK DO ABACATEPAY
// ============================================================

const { config } = require("../config/config");
const { verificarAssinaturaWebhook } = require("../services/abacatePayService");
const { eventoJaProcessado } = require("../utils/idempotencia");
const { ESTADOS, getSessao, obterChatPorPagamento, removerPagamentoPendente } = require("../state/sessionManager");
const { despacharPedidoConfirmado } = require("../services/pedidoService");
const { buscarPedidoPorTransacao } = require("../repositories/pedidoRepository");

/**
 * Rota POST /webhooks/abacatepay
 * Recebe e valida as notificações de eventos enviadas pela AbacatePay.
 */
async function handleAbacatePayWebhook(req, res) {
    try {
        // ====================================================
        // 1. VALIDAÇÃO DO SECRET NA URL
        // ====================================================
        const secretRecebido = req.query.webhookSecret;
        if (secretRecebido !== config.abacatePay.webhookSecret) {
            console.warn("🚫 [Webhook] Requisição rejeitada: webhookSecret inválido na URL.");
            return res.status(401).json({ error: "Unauthorized: Invalid webhook secret" });
        }

        // ====================================================
        // 2. VERIFICAÇÃO DO CORPO RAW
        // ====================================================
        if (!Buffer.isBuffer(req.body)) {
            console.error("❌ [Webhook] Erro: Corpo bruto (RAW Buffer) não recebido pelo Express.");
            return res.status(400).json({ error: "Invalid body: expected raw buffer" });
        }

        const rawBody = req.body.toString("utf8");

        // ====================================================
        // 3. VALIDAÇÃO DA ASSINATURA HMAC-SHA256
        // ====================================================
        const assinatura = req.headers["x-webhook-signature"];
        if (!verificarAssinaturaWebhook(rawBody, assinatura)) {
            console.warn("🚫 [Webhook] Requisição rejeitada: Assinatura HMAC inválida no header 'x-webhook-signature'.");
            return res.status(401).json({ error: "Unauthorized: Invalid signature" });
        }

        // ====================================================
        // 4. PARSE DO JSON
        // ====================================================
        let evento;
        try {
            evento = JSON.parse(rawBody);
        } catch (errJson) {
            console.error("❌ [Webhook] Erro ao realizar parse do JSON recebido:", errJson.message);
            return res.status(400).json({ error: "Invalid JSON format" });
        }

        console.log("================================");
        console.log("📨 [Webhook] Evento recebido do AbacatePay");
        console.log("Tipo:", evento.event);
        console.log("ID do Evento:", evento.id);
        console.log("================================");

        // ====================================================
        // 5. CONTROLE DE IDEMPOTÊNCIA DO EVENTO
        // ====================================================
        if (!evento.id) {
            console.warn("⚠️ [Webhook] Evento recebido sem ID único.");
            return res.status(400).json({ error: "Event ID is required" });
        }

        if (eventoJaProcessado(evento.id)) {
            console.log(`⚠️ [Webhook] Evento duplicado já processado (${evento.id}). Ignorando.`);
            return res.status(200).json({ received: true, duplicate: true });
        }

        // ====================================================
        // 6. PROCESSAMENTO DE PAGAMENTO CONFIRMADO
        // ====================================================
        if (
            evento.event === "transparent.completed" ||
            evento.event === "billing.paid" ||
            evento.event === "checkout.completed"
        ) {
            await processarWebhookPagamento(evento);
        } else {
            console.log(`ℹ️ [Webhook] Evento "${evento.event}" recebido sem necessidade de ação.`);
        }

        // Responde 200 OK para o AbacatePay confirmar a entrega
        return res.status(200).json({ received: true });

    } catch (err) {
        console.error("================================");
        console.error("❌ [Webhook] Erro não tratado no processamento do webhook:", err.message);
        console.error(err);
        console.error("================================");

        return res.status(500).json({ error: "Internal server error" });
    }
}

/**
 * Processa a confirmação de pagamento recebida no webhook:
 * 1. Identifica o ID do PIX.
 * 2. Localiza o chatId e a sessão ativa.
 * 3. Envia o pedido para o grupo "pedidos".
 * 4. Notifica o cliente.
 * 5. Atualiza o status interno para PREPARANDO e finaliza.
 *
 * @param {object} evento - Payload do webhook.
 */
async function processarWebhookPagamento(evento) {
    const dados = evento?.data;
    if (!dados) {
        console.error("❌ [Webhook] Payload do evento não possui propriedade 'data'.");
        return;
    }

    // Na API v2, os dados podem vir em pixQrCode, pix, transparent, billing ou direto em data
    const pixData = dados.pixQrCode || dados.pix || dados.transparent || dados.billing || dados;
    const pagamentoId = pixData?.id || dados?.id || dados?.pixQrCode?.id || dados?.transparent?.id;

    if (!pagamentoId) {
        console.error("❌ [Webhook] ID do pagamento não encontrado na estrutura do evento.");
        return;
    }

    // 1. Recuperar o chatId do cliente
    let chatId = obterChatPorPagamento(pagamentoId);

    // Fallback por metadata do evento
    if (!chatId) {
        chatId = dados?.metadata?.chatId || pixData?.metadata?.chatId || evento?.metadata?.chatId;
    }

    if (!chatId) {
        console.warn(`⚠️ [Webhook] Pagamento ${pagamentoId} confirmado, mas nenhum chatId correspondente foi encontrado em memória.`);
        return;
    }

    const sessao = getSessao(chatId);

    // O mapa de sessões é propositalmente temporário. Se o processo reiniciou
    // entre a geração do PIX e o webhook, recompõe os dados necessários a
    // partir do pedido persistido para não perder uma venda já paga.
    if (!sessao.pedidoDbId || sessao.pedido.length === 0) {
        const pedidoSalvo = await buscarPedidoPorTransacao(pagamentoId);
        if (!pedidoSalvo) {
            console.warn(`⚠️ [Webhook] Pedido persistido não encontrado para o pagamento ${pagamentoId}.`);
            return;
        }

        sessao.pedidoDbId = pedidoSalvo.id;
        sessao.pedido = pedidoSalvo.itens;
        sessao.cliente = {
            nome: pedidoSalvo.cliente_nome,
            aniversario: pedidoSalvo.aniversario,
            endereco: pedidoSalvo.tipo_entrega === "RETIRADA"
                ? "Retirada no local"
                : pedidoSalvo.endereco_entrega,
            pagamento: "Pix"
        };
        sessao.pagamento = {
            ...sessao.pagamento,
            id: pagamentoId,
            status: "PAID"
        };
    }

    // 2. Verificar se o pedido já foi despachado (Prevenção de duplicidade)
    if (sessao.pedidoEnviadoParaNumero || sessao.pedidoFinalizado) {
        console.log(`⚠️ [Webhook] Pedido do cliente ${sessao.cliente?.nome} (${chatId}) já foi despachado anteriormente. Evitando envio duplicado.`);
        removerPagamentoPendente(pagamentoId);
        return;
    }

    // 3. Atualizar status de pagamento
    sessao.pagamento.status = "PAID";
    sessao.etapa = ESTADOS.PAGAMENTO_CONFIRMADO;

    console.log("================================");
    console.log("💰 [Webhook] PAGAMENTO PIX CONFIRMADO!");
    console.log(`PIX ID: ${pagamentoId}`);
    console.log(`Cliente: ${sessao.cliente?.nome || "Não informado"}`);
    console.log(`WhatsApp: ${chatId}`);
    console.log("================================");

    // 4. Despachar pedido para o grupo "pedidos" e notificar cliente
    try {
        await despacharPedidoConfirmado({
            sessao,
            chatId,
            status: "PREPARANDO",
            isPix: true
        });

        // Limpeza do mapa temporário de pendências
        removerPagamentoPendente(pagamentoId);

    } catch (errDespacho) {
        console.error(`❌ [Webhook] Falha ao despachar pedido ${pagamentoId} para o grupo:`, errDespacho.message);
        // O pedido não é marcado como finalizado aqui para possibilitar reprocessamento
    }
}

module.exports = {
    handleAbacatePayWebhook,
    processarWebhookPagamento
};
