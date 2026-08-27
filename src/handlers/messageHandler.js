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
                        "Data inválida 😅\n\nUse o formato *dd/mm* (exemplo: *15/03*) ou digite *pular*."
                    );
                    return;
                }
                sessao.cliente.aniversario = textoLimpo;
            }

            sessao.etapa = ESTADOS.ENDERECO;
            await enviarMensagem(
                chatId,
                "Agora me envie o *endereço completo* para entrega 📍\n\n(Rua, número, bairro e ponto de referência)"
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 6: ENDEREÇO DE ENTREGA
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
                "*2* - Pagar na entrega"
            );
            break;
        }

        // ----------------------------------------------------
        // ESTADO 7: FORMA DE PAGAMENTO
        // ----------------------------------------------------
        case ESTADOS.PAGAMENTO: {
            // Opção 1: PIX
            if (textoLimpo === "1") {
                sessao.cliente.pagamento = "Pix";

                try {
                    await enviarMensagem(
                        chatId,
                        "Só um momento... 💳\n\nEstou gerando seu código PIX seguro."
                    );

                    const total = totalPedido(sessao.pedido);
                    const pix = await criarCobrancaPix({
                        valorReais: total,
                        chatId,
                        cliente: sessao.cliente
                    });

                    // Salva dados do PIX na sessão
                    sessao.pagamento = {
                        id: pix.id,
                        status: pix.status,
                        brCode: pix.brCode,
                        brCodeBase64: pix.brCodeBase64,
                        expiresAt: pix.expiresAt
                    };

                    // Vincula para localização imediata quando o webhook chegar
                    vincularPagamento(pix.id, chatId);

                    // 1. Enviar Imagem do QR Code se disponível
                    if (pix.brCodeBase64) {
                        try {
                            const base64Limpo = pix.brCodeBase64.replace(/^data:image\/\w+;base64,/, "");
                            const mediaQr = new MessageMedia("image/png", base64Limpo, "pix_qrcode.png");

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
                            console.error("⚠️ [Handler] Não foi possível enviar imagem do QR Code:", errQr.message);
                        }
                    }

                    // 2. Enviar Código Copia e Cola em bloco formatado
                    await enviarMensagem(
                        chatId,
                        "📋 *PIX Copia e Cola*\n\n" +
                        "```" + pix.brCode + "```\n\n" +
                        `💰 Valor: *${formatarMoeda(total)}*\n\n` +
                        "Assim que o pagamento for confirmado pelo banco, seu pedido será enviado automaticamente para a nossa equipe iniciar o preparo! ✅"
                    );

                    sessao.etapa = ESTADOS.AGUARDANDO_PIX;

                } catch (errPix) {
                    console.error(`❌ [Handler] Falha ao gerar PIX para ${chatId}:`, errPix.message);
                    sessao.etapa = ESTADOS.PAGAMENTO;

                    await enviarMensagem(
                        chatId,
                        "Não consegui gerar o PIX neste momento 😕\n\n" +
                        "Por favor, tente novamente escolhendo:\n\n" +
                        "*1* - Pix\n" +
                        "*2* - Pagar na entrega"
                    );
                }

            // Opção 2: Pagamento na Entrega
            } else if (textoLimpo === "2") {
                sessao.cliente.pagamento = "Pagamento na entrega";

                try {
                    await despacharPedidoConfirmado({
                        sessao,
                        chatId,
                        status: "PENDENTE (PAGAR NA ENTREGA)",
                        isPix: false
                    });
                } catch (errEntrega) {
                    console.error(`❌ [Handler] Falha ao finalizar pedido na entrega para ${chatId}:`, errEntrega.message);
                    await enviarMensagem(
                        chatId,
                        "Tivemos um problema ao registrar seu pedido 😕\n\nNossa equipe já foi notificada. Por favor, tente novamente em alguns instantes."
                    );
                }

            } else {
                await enviarMensagem(
                    chatId,
                    "Escolha uma opção válida:\n\n*1* - Pix\n*2* - Pagar na entrega"
                );
            }

            break;
        }

        // ----------------------------------------------------
        // ESTADO 8: AGUARDANDO CONFIRMAÇÃO DO PIX
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
        // ESTADO 9/10: PREPARANDO OU FINALIZADO
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
