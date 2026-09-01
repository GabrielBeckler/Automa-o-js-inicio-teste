// ============================================================
// HANDLER DE MENSAGENS E MÁQUINA DE ESTADOS DO BOT
// ============================================================

const fs = require("fs");
const { config } = require("../config/config");
const { formatarCardapio, buscarItem } = require("../../cardapio");
const { ESTADOS, getSessao, resetarSessao, vincularPagamento } = require("../state/sessionManager");
const { validarAniversario, validarNome, validarEndereco, validarQuantidade } = require("../utils/validacoes");
const { totalPedido, resumoPedido, formatarMoeda } = require("../utils/formatadores");
const { enviarMensagem, MessageMedia } = require("../services/whatsappService");
const { criarCobrancaPix } = require("../services/abacatePayService");
const { despacharPedidoConfirmado } = require("../services/pedidoService");
const { criarPedido } = require("../repositories/pedidoRepository");

/**
 * Ponto de entrada para processamento de qualquer mensagem recebida no WhatsApp.
 * @param {object} client - Instância do whatsapp-web.js.
 * @param {string} chatId - ID do remetente.
 * @param {string} texto - Texto da mensagem.
 * @param {object} msg - Mensagem bruta.
 */
async function processarMensagemRecebida(client, chatId, texto, msg) {
    const sessao = getSessao(chatId);
    const textoLimpo = (texto || "").trim();
    const textoLower = textoLimpo.toLowerCase();

    // ========================================================
    // COMANDOS GLOBAIS DE CANCELAMENTO / REINÍCIO
    // ========================================================
    if (
        textoLower === "cancelar" ||
        textoLower === "recomeçar" ||
        textoLower === "recomecar"
    ) {
        resetarSessao(chatId);
        await enviarMensagem(
            chatId,
            "Pedido cancelado. ❌\n\nDigite qualquer mensagem para começar novamente. 🍦"
        );
        return;
    }

    // ========================================================
    // MÁQUINA DE ESTADOS DA CONVERSA
    // ========================================================
    switch (sessao.etapa) {

        // ----------------------------------------------------
        // ESTADO 1: INÍCIO (Boas-vindas e Cardápio)
        // ----------------------------------------------------
        case ESTADOS.INICIO: {
            await enviarMensagem(
                chatId,
                "Olá! Tudo bem? 🍦\n\nBem-vindo(a) à nossa sorveteria!\n\nSegue nosso cardápio:"
            );

            // Envio do Cardápio em Imagem
            let enviouImagem = false;
            if (fs.existsSync(config.paths.caminhoMenu)) {
                try {
                    const media = MessageMedia.fromFilePath(config.paths.caminhoMenu);
                    await enviarMensagem(
                        chatId,
                        media,
                        {
                            caption: "📋 *Nosso Cardápio* 🍦\n\nEscolha o número do item que deseja!"
                        }
                    );
                    enviouImagem = true;
                } catch (errMenu) {
                    console.error("❌ [Handler] Falha ao enviar imagem do cardápio:", errMenu.message);
                }
            }

            // Fallback para Cardápio em Texto se a imagem não existir ou falhar
            if (!enviouImagem) {
                await enviarMensagem(
                    chatId,
                    "📋 *Nosso Cardápio* 🍦\n\n" + formatarCardapio()
                );
            }

            await enviarMensagem(
                chatId,
                "Digite o *número* do item que deseja.\n\n" +
                "Quando terminar suas escolhas, digite *fim*.\n\n" +
                "A qualquer momento você pode digitar *cancelar*."
            );

            sessao.etapa = ESTADOS.PEDIDO;
            break;
        }

        // ----------------------------------------------------
        // ESTADO 2: PEDIDO (Seleção de Itens)
        // ----------------------------------------------------
        case ESTADOS.PEDIDO: {
            if (textoLower === "fim") {
                if (!sessao.pedido || sessao.pedido.length === 0) {
                    await enviarMensagem(
                        chatId,
                        "Você ainda não escolheu nenhum item. 😅\n\nDigite o número do produto desejado:"
                    );
                    return;
                }

                const total = totalPedido(sessao.pedido);
                await enviarMensagem(
                    chatId,
                    "🧾 *Resumo do pedido*\n\n" +
                    resumoPedido(sessao.pedido) + "\n\n" +
                    `*Total: ${formatarMoeda(total)}*\n\n` +
                    "Qual é o seu *nome*?"
                );

                sessao.etapa = ESTADOS.NOME;
                return;
            }

            const item = buscarItem(textoLimpo);
            if (!item) {
                await enviarMensagem(
                    chatId,
                    "Não encontrei esse item 🤔\n\n" +
                    "Digite o número exatamente como aparece no cardápio.\n\n" +
                    "Ou digite *fim* para encerrar a escolha de itens."
                );
                return;
            }

            sessao.itemPendente = item;
            sessao.etapa = ESTADOS.QUANTIDADE;

            await enviarMensagem(
                chatId,
                `Quantas unidades de "${item.nome}" você deseja?`
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 3: QUANTIDADE
        // ----------------------------------------------------
        case ESTADOS.QUANTIDADE: {
            const validacao = validarQuantidade(textoLimpo);
            if (!validacao.valido) {
                await enviarMensagem(chatId, `${validacao.motivo}\n\nExemplo: *1*, *2* ou *3*.`);
                return;
            }

            const item = sessao.itemPendente;
            if (!item) {
                sessao.etapa = ESTADOS.PEDIDO;
                await enviarMensagem(
                    chatId,
                    "Tive um problema ao identificar o produto selecionado 😕\n\nPor favor, escolha o item novamente:"
                );
                return;
            }

            sessao.pedido.push({
                ...item,
                quantidade: validacao.quantidade
            });

            sessao.itemPendente = null;
            sessao.etapa = ESTADOS.PEDIDO;

            await enviarMensagem(
                chatId,
                `Adicionado ✅ (${validacao.quantidade}x ${item.nome})\n\n` +
                "Digite outro número do cardápio para adicionar mais, ou digite *fim* para avançar."
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 4: NOME DO CLIENTE
        // ----------------------------------------------------
        case ESTADOS.NOME: {
            const validacao = validarNome(textoLimpo);
            if (!validacao.valido) {
                await enviarMensagem(chatId, `${validacao.motivo} 😊`);
                return;
            }

            sessao.cliente.nome = textoLimpo;
            sessao.etapa = ESTADOS.ANIVERSARIO;

            await enviarMensagem(
                chatId,
                "Qual sua data de aniversário? 🎂\n\n" +
                "Formato: *dd/mm* (Exemplo: *15/03*)\n\n" +
                "Se preferir não informar, basta digitar *pular*."
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 5: ANIVERSÁRIO
        // ----------------------------------------------------
        case ESTADOS.ANIVERSARIO: {
            if (textoLower === "pular") {
                sessao.cliente.aniversario = null;

            } else {

                if (!validarAniversario(textoLimpo)) {

                    await enviarMensagem(
                        chatId,
                        "Data inválida 😅\n\n" +
                        "Use o formato *dd/mm* (exemplo: *15/03*) " +
                        "ou digite *pular*."
                    );

                    return;
                }

                sessao.cliente.aniversario = textoLimpo;
            }

            // Próxima etapa: escolher entrega ou retirada
            sessao.etapa = ESTADOS.ENTREGA_OU_RETIRADA;

            await enviarMensagem(
                chatId,
                "Como você deseja receber seu pedido? 🍦\n\n" +
                "*1* - 🚚 Entrega\n" +
                "*2* - 🏪 Retirada no local"
            );

            break;
        }

        // ----------------------------------------------------
        // ESTADO: 6 ENTREGA OU RETIRADA
        // ----------------------------------------------------

       case ESTADOS.ENTREGA_OU_RETIRADA: {

        // ========================================================
        // ENTREGA
        // ========================================================

        if (
            textoLower === "1" ||
            textoLower === "entrega"
        ) {

            sessao.etapa = ESTADOS.ENDERECO;

            await enviarMensagem(
                chatId,
                "🚚 *Entrega selecionada!*\n\n" +
                "Agora me envie o *endereço completo* para entrega 📍\n\n" +
                "Exemplo:\n" +
                "*Rua das Flores, 123 - Centro*\n\n" +
                "Se possível, informe também um ponto de referência."
            );

        // ========================================================
        // RETIRADA
        // ========================================================

        } else if (
            textoLower === "2" ||
            textoLower === "retirada"
        ) {

            sessao.cliente.endereco = "Retirada no local";
            sessao.etapa = ESTADOS.PAGAMENTO;

            await enviarMensagem(
                chatId,
                "Perfeito! Agora escolha a forma de pagamento: 💳\n\n" +
                "*1* - Pix\n" +
                "*2* - Dinheiro\n" +
                "*3* - Cartão"
            );

        // ========================================================
        // OPÇÃO INVÁLIDA
        // ========================================================

        } else {

            await enviarMensagem(
                chatId,
                "Não entendi sua escolha 😅\n\n" +
                "Como você deseja receber seu pedido?\n\n" +
                "*1* - 🚚 Entrega\n" +
                "*2* - 🏪 Retirada no local"
            );
        }

        break;
    }


        // ----------------------------------------------------
        // ESTADO 7: ENDEREÇO DE ENTREGA
        // ----------------------------------------------------
         case ESTADOS.ENDERECO: {
            const validacao = validarEndereco(textoLimpo);
             if (!validacao.valido) {
                 await enviarMensagem(chatId, `${validacao.motivo} 📍\n\nExemplo:\n*Rua das Flores, 123 - Centro*`);
                 return;
            }

             sessao.cliente.endereco = textoLimpo;
             sessao.etapa = ESTADOS.PAGAMENTO;

             await enviarMensagem(
                 chatId,
                 "Qual a forma de pagamento? 💳\n\n" +
                "*1* - Pix\n" +
                "*2* - Dinheiro\n" +
                "*3* - Cartão"
             );
             break;
         }

// ============================================================
// ESTADO 8: FORMA DE PAGAMENTO
// ============================================================

case ESTADOS.PAGAMENTO: {

    // ========================================================
    // PIX
    // ========================================================

    if (textoLimpo === "1") {

        sessao.cliente.pagamento = "Pix";

        try {

            await enviarMensagem(
                chatId,
                "Só um momento... 💳\n\n" +
                "Estou gerando seu código PIX seguro."
            );

            const total =
                totalPedido(sessao.pedido);

            const pix =
                await criarCobrancaPix({
                    valorReais: total,
                    chatId,
                    cliente: sessao.cliente
                });

            // Salva dados do PIX
            sessao.pagamento = {
                id: pix.id,
                status: pix.status,
                brCode: pix.brCode,
                brCodeBase64: pix.brCodeBase64,
                expiresAt: pix.expiresAt
            };

            vincularPagamento(
                pix.id,
                chatId
            );

            // Mantém uma referência persistente da cobrança PIX pendente.
            // O pedido só é enviado para produção após o webhook de confirmação.
            sessao.pedidoDbId = await criarPedido({
                sessao,
                chatId,
                transacaoId: pix.id,
                pagamentoStatus: "PENDENTE"
            });

            // =================================================
            // QR CODE
            // =================================================

            if (pix.brCodeBase64) {

                try {

                    const base64Limpo =
                        pix.brCodeBase64.replace(
                            /^data:image\/\w+;base64,/,
                            ""
                        );

                    const mediaQr =
                        new MessageMedia(
                            "image/png",
                            base64Limpo,
                            "pix_qrcode.png"
                        );

                    await enviarMensagem(
                        chatId,
                        mediaQr,
                        {
                            caption:
                                "💳 *Pagamento via PIX*\n\n" +
                                `Valor: *${formatarMoeda(total)}*\n\n` +
                                "Escaneie o QR Code acima ou utilize o código Copia e Cola abaixo.\n\n" +
                                "⏳ O código expira em 30 minutos."
                        }
                    );

                } catch (errQr) {

                    console.error(
                        "⚠️ [Handler] Não foi possível enviar imagem do QR Code:",
                        errQr.message
                    );
                }
            }

            // =================================================
            // PIX COPIA E COLA
            // =================================================

            await enviarMensagem(
                chatId,
                "📋 *PIX Copia e Cola*\n\n" +
                "```" +
                pix.brCode +
                "```\n\n" +
                `💰 Valor: *${formatarMoeda(total)}*\n\n` +
                "Assim que o pagamento for confirmado, " +
                "seu pedido será enviado automaticamente para nossa equipe. ✅"
            );

            sessao.etapa =
                ESTADOS.AGUARDANDO_PIX;

        } catch (errPix) {

            console.error(
                `❌ [Handler] Falha ao gerar PIX para ${chatId}:`,
                errPix.message
            );

            sessao.etapa =
                ESTADOS.PAGAMENTO;

            await enviarMensagem(
                chatId,
                "Não consegui gerar o PIX neste momento 😕\n\n" +
                "Por favor, tente novamente:\n\n" +
                "*1* - Pix\n" +
                "*2* - Dinheiro\n" +
                "*3* - Cartão"
            );
        }

    // ========================================================
    // DINHEIRO
    // ========================================================

    } else if (textoLimpo === "2") {

        sessao.cliente.pagamento =
            "Dinheiro";

        sessao.etapa =
            ESTADOS.TROCO;

        await enviarMensagem(
            chatId,
            "💵 *Pagamento em dinheiro*\n\n" +
            "Você precisa de troco?\n\n" +
            "*1* - Não preciso de troco\n" +
            "*2* - Sim, preciso de troco"
        );

    // ========================================================
    // CARTÃO
    // ========================================================

    } else if (textoLimpo === "3") {

        sessao.cliente.pagamento =
            "Cartão";

        sessao.cliente.dinheiroRecebido =
            null;

        sessao.cliente.troco =
            0;

        try {

            await despacharPedidoConfirmado({
                sessao,
                chatId,
                status: "PENDENTE (PAGAR NA ENTREGA)",
                isPix: false
            });

        } catch (errCartao) {

            console.error(
                `❌ [Handler] Falha ao finalizar pedido com cartão para ${chatId}:`,
                errCartao.message
            );

            await enviarMensagem(
                chatId,
                "Tivemos um problema ao registrar seu pedido 😕\n\n" +
                "Nossa equipe já foi notificada. " +
                "Por favor, tente novamente em alguns instantes."
            );
        }

    } else {

        await enviarMensagem(
            chatId,
            "Escolha uma opção válida:\n\n" +
            "*1* - Pix\n" +
            "*2* - Dinheiro\n" +
            "*3* - Cartão"
        );
    }

    break;
}


// ============================================================
// ESTADO 9: NECESSIDADE DE TROCO
// ============================================================

case ESTADOS.TROCO: {

    // ========================================================
    // NÃO PRECISA DE TROCO
    // ========================================================

    if (textoLimpo === "1") {

        sessao.cliente.dinheiroRecebido =
            totalPedido(sessao.pedido);

        sessao.cliente.troco = 0;

        sessao.cliente.precisaTroco = false;

        try {

            await despacharPedidoConfirmado({
                sessao,
                chatId,
                status: "PENDENTE (PAGAR EM DINHEIRO)",
                isPix: false
            });

        } catch (errDinheiro) {

            console.error(
                `❌ [Handler] Falha ao finalizar pedido em dinheiro para ${chatId}:`,
                errDinheiro.message
            );

            await enviarMensagem(
                chatId,
                "Tivemos um problema ao registrar seu pedido 😕\n\n" +
                "Nossa equipe já foi notificada. " +
                "Por favor, tente novamente em alguns instantes."
            );
        }

    // ========================================================
    // PRECISA DE TROCO
    // ========================================================

    } else if (textoLimpo === "2") {

        sessao.cliente.precisaTroco = true;

        sessao.etapa =
            ESTADOS.VALOR_TROCO;

        const total =
            totalPedido(sessao.pedido);

        await enviarMensagem(
            chatId,
            "💵 *Troco para quanto?*\n\n" +
            `O total do seu pedido é *${formatarMoeda(total)}*.\n\n` +
            "Informe o valor que você vai pagar.\n\n" +
            "Exemplo: *20*, *50* ou *100*"
        );

    } else {

        await enviarMensagem(
            chatId,
            "Não entendi 😅\n\n" +
            "Você precisa de troco?\n\n" +
            "*1* - Não preciso de troco\n" +
            "*2* - Sim, preciso de troco"
        );
    }

    break;
}


// ============================================================
// ESTADO 10: VALOR PARA TROCO
// ============================================================

case ESTADOS.VALOR_TROCO: {

    const total =
        totalPedido(sessao.pedido);

    // ========================================================
    // NORMALIZAR VALOR
    // ========================================================

    let valorTexto =
        textoLimpo
            .replace(/R\$/gi, "")
            .replace(/\s/g, "");

    /*
     * Aceita:
     *
     * 50
     * 50,00
     * 50.00
     * R$ 50,00
     */

    if (
        valorTexto.includes(",") &&
        valorTexto.includes(".")
    ) {

        // Ex: 1.500,00
        valorTexto =
            valorTexto
                .replace(/\./g, "")
                .replace(",", ".");

    } else if (
        valorTexto.includes(",")
    ) {

        // Ex: 50,00
        valorTexto =
            valorTexto.replace(",", ".");
    }

    const valorRecebido =
        Number(valorTexto);

    // ========================================================
    // VALIDAR NÚMERO
    // ========================================================

    if (
        !Number.isFinite(valorRecebido) ||
        valorRecebido <= 0
    ) {

        await enviarMensagem(
            chatId,
            "❌ Valor inválido.\n\n" +
            "Informe um valor válido.\n\n" +
            "Exemplo: *20*, *50* ou *100*."
        );

        return;
    }

    // ========================================================
    // VALOR INSUFICIENTE
    // ========================================================

    if (valorRecebido < total) {

        await enviarMensagem(
            chatId,
            "❌ Esse valor não é suficiente para o pagamento.\n\n" +
            `🧾 Total do pedido: *${formatarMoeda(total)}*\n` +
            `💵 Você informou: *${formatarMoeda(valorRecebido)}*\n\n` +
            `Informe um valor igual ou maior que *${formatarMoeda(total)}*.`
        );

        return;
    }

    // ========================================================
    // CALCULAR TROCO
    // ========================================================

    const troco =
        Number(
            (valorRecebido - total).toFixed(2)
        );

    sessao.cliente.dinheiroRecebido =
        valorRecebido;

    sessao.cliente.troco =
        troco;

    sessao.cliente.precisaTroco =
        troco > 0;

    // ========================================================
    // CONFIRMAÇÃO
    // ========================================================

    await enviarMensagem(
        chatId,
        "✅ *Pagamento em dinheiro registrado!*\n\n" +
        `🧾 Total: *${formatarMoeda(total)}*\n` +
        `💵 Pagará com: *${formatarMoeda(valorRecebido)}*\n` +
        `💰 Troco: *${formatarMoeda(troco)}*\n\n` +
        "Seu pedido está sendo registrado. 🍦"
    );

    // ========================================================
    // DESPACHAR PEDIDO
    // ========================================================

    try {

        await despacharPedidoConfirmado({
            sessao,
            chatId,
            status: "PENDENTE (PAGAR EM DINHEIRO)",
            isPix: false
        });

    } catch (errDinheiro) {

        console.error(
            `❌ [Handler] Falha ao finalizar pedido em dinheiro para ${chatId}:`,
            errDinheiro.message
        );

        await enviarMensagem(
            chatId,
            "Tivemos um problema ao registrar seu pedido 😕\n\n" +
            "Nossa equipe já foi notificada. " +
            "Por favor, tente novamente em alguns instantes."
        );
    }

    break;
}


        // ----------------------------------------------------
        // ESTADO 9: AGUARDANDO CONFIRMAÇÃO DO PIX
        // ----------------------------------------------------
        case ESTADOS.AGUARDANDO_PIX: {
            await enviarMensagem(
                chatId,
                "⏳ Ainda estou aguardando a confirmação do seu pagamento PIX.\n\n" +
                "Assim que o banco confirmar, seu pedido será enviado imediatamente para a produção! ✅\n\n" +
                "Se precisar cancelar, digite *cancelar*."
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 10/11: PREPARANDO OU FINALIZADO
        // ----------------------------------------------------
        case ESTADOS.PREPARANDO:
        case ESTADOS.PAGAMENTO_CONFIRMADO: {
            await enviarMensagem(
                chatId,
                "Seu pagamento já foi confirmado e seu pedido está sendo preparado! 🍦❤️\n\n" +
                "Se quiser iniciar um novo pedido, digite *recomeçar*."
            );
            break;
        }

        case ESTADOS.FINALIZADO: {
            await enviarMensagem(
                chatId,
                "Seu pedido já está registrado com a nossa equipe! 🍨\n\n" +
                "Para fazer um novo pedido, digite *recomeçar*."
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO DESCONHECIDO (Recuperação)
        // ----------------------------------------------------
        default: {
            console.warn(`⚠️ [Handler] Estado não reconhecido: "${sessao.etapa}" para chatId: ${chatId}. Resetando sessão.`);
            resetarSessao(chatId);
            await enviarMensagem(
                chatId,
                "Vamos começar de novo! 🍦\n\nDigite qualquer mensagem para ver o cardápio."
            );
            break;
        }
    }
}

module.exports = {
    processarMensagemRecebida
};
