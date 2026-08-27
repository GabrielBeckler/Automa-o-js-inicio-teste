// ============================================================
// BOT DE ATENDIMENTO - SORVETERIA
// WhatsApp + AbacatePay PIX
// ============================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");

const {
    Client,
    LocalAuth,
    MessageMedia
} = require("whatsapp-web.js");

const qrcode = require("qrcode-terminal");

const {
    formatarCardapio,
    buscarItem
} = require("./cardapio");

// ============================================================
// CONFIGURAÇÃO
// ============================================================

const NUMERO_LOJA =
    process.env.NUMERO_LOJA;

const ABACATEPAY_API_KEY =
    process.env.ABACATEPAY_API_KEY;

const ABACATEPAY_WEBHOOK_SECRET =
    process.env.ABACATEPAY_WEBHOOK_SECRET;

const DEFAULT_ABACATEPAY_PUBLIC_KEY =
    "t9dXRhHHo3yDEj5pVDYz0frf7q6bMKyMRmxxCPIPp3RCplBfXRxqlC6ZpiWmOqj4L63qEaeUOtrCI8P0VMUgo6iIga2ri9ogaHFs0WIIywSMg0q7RmBfybe1E5XJcfC4IW3alNqym0tXoAKkzvfEjZxV6bE0oG2zJrNNYmUCKZyV0KZ3JS8Votf9EAWWYdiDkMkpbMdPggfh1EqHlVkMiTady6jOR3hyzGEHrIz2Ret0xHKMbiqkr9HS1JhNHDX9";

const ABACATEPAY_PUBLIC_KEY =
    (process.env.ABACATEPAY_PUBLIC_KEY && process.env.ABACATEPAY_PUBLIC_KEY.trim() !== "")
        ? process.env.ABACATEPAY_PUBLIC_KEY.trim()
        : DEFAULT_ABACATEPAY_PUBLIC_KEY;

const PORT =
    Number(process.env.PORT) || 3000;

const CAMINHO_MENU =
    path.resolve(
        __dirname,
        "img/menu/menu.png"
    );

// ============================================================
// VALIDAÇÕES DE CONFIGURAÇÃO
// ============================================================

function validarConfiguracao() {

    if (!NUMERO_LOJA) {
        throw new Error(
            "NUMERO_LOJA não foi configurado no .env"
        );
    }

    if (!/^\d+$/.test(NUMERO_LOJA)) {
        throw new Error(
            "NUMERO_LOJA deve conter apenas números."
        );
    }

    if (
        !ABACATEPAY_API_KEY ||
        ABACATEPAY_API_KEY.trim() === ""
    ) {
        throw new Error(
            "ABACATEPAY_API_KEY não foi configurada no .env"
        );
    }

    if (
        !ABACATEPAY_WEBHOOK_SECRET ||
        ABACATEPAY_WEBHOOK_SECRET.trim() === ""
    ) {
        throw new Error(
            "ABACATEPAY_WEBHOOK_SECRET não foi configurado no .env"
        );
    }

    if (
        !ABACATEPAY_PUBLIC_KEY ||
        ABACATEPAY_PUBLIC_KEY.trim() === ""
    ) {
        throw new Error(
            "ABACATEPAY_PUBLIC_KEY não foi configurada."
        );
    }
}

// ============================================================
// ABACATEPAY
// ============================================================

// O pacote @abacatepay/sdk@2.x é ESM.
//
// Como este arquivo usa CommonJS,
// fazemos import() dinamicamente.
//
// Não use:
// const { AbacatePay } = require("@abacatepay/sdk");

let abacate = null;

async function inicializarAbacatePay() {

    const {
        AbacatePay
    } = await import("@abacatepay/sdk");

    abacate = AbacatePay({
        secret: ABACATEPAY_API_KEY
    });

    console.log(
        "🥑 AbacatePay SDK inicializado."
    );
}

// ============================================================
// CARDÁPIO
// ============================================================

function verificarCardapio() {

    if (!fs.existsSync(CAMINHO_MENU)) {

        console.warn(
            "⚠️ Cardápio em imagem não encontrado:"
        );

        console.warn(
            CAMINHO_MENU
        );

        console.warn(
            "O bot continuará usando o cardápio em texto."
        );

        return;
    }

    console.log(
        "📋 Cardápio encontrado:"
    );

    console.log(
        CAMINHO_MENU
    );
}

// ============================================================
// SESSÕES
// ============================================================

const sessoes = new Map();

// ============================================================
// MENSAGENS PROCESSADAS
// ============================================================

const mensagensProcessadas =
    new Map();

const TEMPO_EXPIRACAO_MENSAGEM =
    5 * 60 * 1000;

// ============================================================
// EVENTOS WEBHOOK PROCESSADOS
// ============================================================

const eventosProcessados =
    new Map();

const TEMPO_EXPIRACAO_EVENTO =
    60 * 60 * 1000;

// ============================================================
// PAGAMENTOS PENDENTES
// ============================================================

// paymentId -> chatId

const pagamentosPendentes =
    new Map();

// ============================================================
// FUNÇÕES AUXILIARES
// ============================================================

function esperar(ms) {

    return new Promise(
        resolve => setTimeout(resolve, ms)
    );
}

function atrasoAleatorio(min, max) {

    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}

// ============================================================
// SESSÃO
// ============================================================

function novaSessao() {

    return {

        etapa: "inicio",

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

        pedidoFinalizado: false

    };
}

function getSessao(chatId) {

    if (!sessoes.has(chatId)) {

        sessoes.set(
            chatId,
            novaSessao()
        );
    }

    return sessoes.get(chatId);
}

function resetarSessao(chatId) {

    sessoes.set(
        chatId,
        novaSessao()
    );
}

// ============================================================
// MENSAGEM DUPLICADA
// ============================================================

function mensagemJaProcessada(msg) {

    const id =
        msg?.id?.id;

    if (!id) {
        return false;
    }

    const agora =
        Date.now();

    for (
        const [
            mensagemId,
            timestamp
        ] of mensagensProcessadas
    ) {

        if (
            agora - timestamp >
            TEMPO_EXPIRACAO_MENSAGEM
        ) {

            mensagensProcessadas.delete(
                mensagemId
            );
        }
    }

    if (
        mensagensProcessadas.has(id)
    ) {

        return true;
    }

    mensagensProcessadas.set(
        id,
        agora
    );

    return false;
}

// ============================================================
// EVENTO WEBHOOK DUPLICADO
// ============================================================

function eventoJaProcessado(eventId) {

    if (!eventId) {
        return false;
    }

    const agora =
        Date.now();

    for (
        const [
            id,
            timestamp
        ] of eventosProcessados
    ) {

        if (
            agora - timestamp >
            TEMPO_EXPIRACAO_EVENTO
        ) {

            eventosProcessados.delete(id);
        }
    }

    if (
        eventosProcessados.has(eventId)
    ) {

        return true;
    }

    eventosProcessados.set(
        eventId,
        agora
    );

    return false;
}

// ============================================================
// PEDIDO
// ============================================================

function totalPedido(pedido) {

    if (
        !Array.isArray(pedido)
    ) {

        return 0;
    }

    return pedido.reduce(
        (soma, item) => {

            const preco =
                Number(item.preco);

            const quantidade =
                Number(item.quantidade);

            if (
                !Number.isFinite(preco) ||
                !Number.isFinite(quantidade)
            ) {

                return soma;
            }

            return soma +
                preco * quantidade;

        },
        0
    );
}

// ============================================================
// RESUMO PEDIDO
// ============================================================

function resumoPedido(pedido) {

    if (
        !Array.isArray(pedido) ||
        pedido.length === 0
    ) {

        return "Nenhum item no pedido.";
    }

    return pedido
        .map(item => {

            const subtotal =
                Number(item.preco) *
                Number(item.quantidade);

            return (
                `- ${item.quantidade}x ${item.nome} ` +
                `(R$ ${subtotal.toFixed(2)})`
            );

        })
        .join("\n");
}

// ============================================================
// VALIDAÇÃO DE ANIVERSÁRIO
// ============================================================

function validarAniversario(data) {

    if (
        typeof data !== "string"
    ) {

        return false;
    }

    // Formato: dd/mm

    if (
        !/^\d{2}\/\d{2}$/.test(data)
    ) {

        return false;
    }

    const [
        dia,
        mes
    ] = data
        .split("/")
        .map(Number);

    if (
        mes < 1 ||
        mes > 12
    ) {

        return false;
    }

    const diasPorMes = [

        31,

        29,

        31,

        30,

        31,

        30,

        31,

        31,

        30,

        31,

        30,

        31

    ];

    if (
        dia < 1 ||
        dia > diasPorMes[mes - 1]
    ) {

        return false;
    }

    return true;
}

// ============================================================
// ENVIO SEGURO
// ============================================================

async function enviarMensagem(
    client,
    chatId,
    conteudo,
    opcoes = {}
) {

    try {

        if (!client) {

            throw new Error(
                "Cliente do WhatsApp indisponível."
            );
        }

        if (!chatId) {

            throw new Error(
                "Chat ID não informado."
            );
        }

        const atraso =
            atrasoAleatorio(
                1000,
                2500
            );

        await esperar(atraso);

        return await client.sendMessage(
            chatId,
            conteudo,
            opcoes
        );

    } catch (err) {

        console.error(
            "❌ Erro ao enviar mensagem."
        );

        console.error(
            "Chat:",
            chatId
        );

        console.error(err);

        throw err;
    }
}

// ============================================================
// CRIAR PIX
// ============================================================

async function criarPagamentoPix(
    sessao,
    chatId
) {

    try {

        if (!abacate) {

            throw new Error(
                "AbacatePay ainda não foi inicializado."
            );
        }

        const total =
            totalPedido(
                sessao.pedido
            );

        if (
            !Number.isFinite(total) ||
            total <= 0
        ) {

            throw new Error(
                "Valor do pedido inválido."
            );
        }

        // AbacatePay trabalha em centavos.

        const valorCentavos =
            Math.round(
                total * 100
            );

        const externalId =
            `pedido_${Date.now()}_${chatId.replace("@c.us", "")}`;

        console.log(
            "💳 Criando cobrança PIX..."
        );

        console.log(
            "Valor:",
            valorCentavos,
            "centavos"
        );

        const resposta =
            await abacate.pix.create({

                amount:
                    valorCentavos,

                expiresIn:
                    30 * 60,

                description:
                    "Pedido Sorveteria",

                metadata: {

                    chatId,

                    externalId,

                    nome:
                        sessao.cliente.nome,

                    endereco:
                        sessao.cliente.endereco

                }

            });

        // ====================================================
        // IMPORTANTE
        // O SDK retorna { data, error, success }
        // e não deve ser tratado apenas via try/catch.
        // ====================================================

        if (
            !resposta ||
            resposta.success !== true
        ) {

            console.error(
                "❌ AbacatePay retornou erro:"
            );

            console.error(
                resposta?.error ||
                resposta
            );

            const msgErro =
                typeof resposta?.error === "string"
                    ? resposta.error
                    : (resposta?.error?.message || "Não foi possível criar o PIX.");

            throw new Error(msgErro);
        }

        const pix =
            resposta.data;

        if (!pix) {

            throw new Error(
                "AbacatePay não retornou os dados do PIX."
            );
        }

        if (!pix.id) {

            throw new Error(
                "AbacatePay não retornou o ID do PIX."
            );
        }

        if (!pix.brCode) {

            throw new Error(
                "AbacatePay não retornou o código PIX."
            );
        }

        // ====================================================
        // SALVA NA SESSÃO
        // ====================================================

        sessao.pagamento = {

            id:
                pix.id,

            status:
                pix.status || "PENDING",

            brCode:
                pix.brCode,

            brCodeBase64:
                pix.brCodeBase64 || null,

            expiresAt:
                pix.expiresAt || null

        };

        // ====================================================
        // MAPA DE PAGAMENTO
        // ====================================================

        pagamentosPendentes.set(
            pix.id,
            chatId
        );

        console.log(
            "✅ PIX criado:"
        );

        console.log(
            "ID:",
            pix.id
        );

        console.log(
            "Status:",
            pix.status
        );

        console.log(
            "External ID:",
            pix.externalId || externalId
        );

        return pix;

    } catch (err) {

        console.error(
            "================================"
        );

        console.error(
            "❌ ERRO AO CRIAR PIX"
        );

        console.error(err);

        console.error(
            "================================"
        );

        throw err;
    }
}

// ============================================================
// ENVIA PIX PARA CLIENTE
// ============================================================

async function enviarPix(
    client,
    chatId,
    sessao
) {

    const pix =
        await criarPagamentoPix(
            sessao,
            chatId
        );

    const total =
        totalPedido(
            sessao.pedido
        );

    // ========================================================
    // QR CODE
    // ========================================================

    if (
        pix.brCodeBase64
    ) {

        try {

            const base64 =
                pix.brCodeBase64.replace(
                    /^data:image\/\w+;base64,/,
                    ""
                );

            const media =
                new MessageMedia(
                    "image/png",
                    base64,
                    "pix.png"
                );

            await enviarMensagem(
                client,
                chatId,
                media,
                {

                    caption:
                        "💳 *Pagamento via PIX*\n\n" +

                        `Valor: *R$ ${total.toFixed(2)}*\n\n` +

                        "Escaneie o QR Code acima " +
                        "ou use o código copia e cola abaixo.\n\n" +

                        "⏳ O pagamento fica disponível por 30 minutos."

                }
            );

        } catch (err) {

            console.error(
                "⚠️ Não foi possível enviar QR Code."
            );

            console.error(err);

            // Continua enviando o copia e cola.
        }
    }

    // ========================================================
    // COPIA E COLA
    // ========================================================

    await enviarMensagem(
        client,
        chatId,

        "📋 *PIX Copia e Cola*\n\n" +

        "```" +
        pix.brCode +
        "```\n\n" +

        `💰 Valor: *R$ ${total.toFixed(2)}*\n\n` +

        "Depois que o pagamento for confirmado, " +
        "seu pedido será enviado automaticamente para a loja. ✅"
    );

    sessao.etapa =
        "aguardando_pix";

    return pix;
}

// ============================================================
// VERIFICAR ASSINATURA WEBHOOK
// ============================================================

function verificarAssinaturaWebhook(
    rawBody,
    assinatura
) {

    if (
        !assinatura
    ) {

        return false;
    }

    if (
        !ABACATEPAY_PUBLIC_KEY
    ) {

        console.error(
            "❌ ABACATEPAY_PUBLIC_KEY não configurada."
        );

        return false;
    }

    try {

        const assinaturaEsperada =
            crypto
                .createHmac(
                    "sha256",
                    ABACATEPAY_PUBLIC_KEY
                )
                .update(
                    Buffer.from(
                        rawBody,
                        "utf8"
                    )
                )
                .digest("base64");

        const A =
            Buffer.from(
                assinaturaEsperada,
                "utf8"
            );

        const B =
            Buffer.from(
                assinatura,
                "utf8"
            );

        if (
            A.length !== B.length
        ) {

            return false;
        }

        return crypto.timingSafeEqual(
            A,
            B
        );

    } catch (err) {

        console.error(
            "❌ Erro ao validar assinatura do webhook:",
            err.message
        );

        return false;
    }
}

// ============================================================
// PROCESSAR PAGAMENTO CONFIRMADO
// ============================================================

async function processarPagamentoConfirmado(
    evento
) {

    try {

        const dados =
            evento?.data;

        if (!dados) {

            console.error(
                "❌ Webhook sem data."
            );

            return;
        }

        // ====================================================
        // NA API V2:
        //
        // data.pixQrCode.id ou data.transparent.id ou data.pix.id
        //
        // ====================================================

        const pixData =
            dados.pixQrCode ||
            dados.pix ||
            dados.transparent ||
            dados.billing ||
            dados;

        const pagamentoId =
            pixData?.id ||
            dados?.id ||
            dados?.pixQrCode?.id ||
            dados?.transparent?.id;

        if (!pagamentoId) {

            console.error(
                "❌ Webhook sem ID do pagamento."
            );

            console.error(
                JSON.stringify(
                    evento,
                    null,
                    2
                )
            );

            return;
        }

        let chatId =
            pagamentosPendentes.get(
                pagamentoId
            );

        // Fallback: tentar recuperar chatId dos metadados
        if (!chatId) {
            chatId =
                dados?.metadata?.chatId ||
                pixData?.metadata?.chatId ||
                evento?.metadata?.chatId;
        }

        // Fallback: buscar na sessão ativa pelo ID do pagamento
        if (!chatId) {
            for (const [id, s] of sessoes.entries()) {
                if (s?.pagamento?.id === pagamentoId) {
                    chatId = id;
                    break;
                }
            }
        }

        if (!chatId) {

            console.warn(
                "⚠️ Pagamento recebido, mas não encontrei o chat."
            );

            console.warn(
                "Pagamento:",
                pagamentoId
            );

            console.warn(
                "External ID:",
                pixData?.externalId || dados?.externalId
            );

            return;
        }

        const sessao =
            sessoes.get(
                chatId
            );

        if (!sessao) {

            console.warn(
                "⚠️ Sessão do cliente não encontrada."
            );

            return;
        }

        // ====================================================
        // EVITA DUPLICAR PEDIDO
        // ====================================================

        if (
            sessao.pedidoFinalizado
        ) {

            console.log(
                "⚠️ Pedido já finalizado."
            );

            pagamentosPendentes.delete(
                pagamentoId
            );

            return;
        }

        // ====================================================
        // CONFIRMA PAGAMENTO
        // ====================================================

        sessao.pagamento.status =
            "PAID";

        sessao.pedidoFinalizado =
            true;

        sessao.etapa =
            "pagamento_confirmado";

        console.log(
            "================================"
        );

        console.log(
            "💰 PAGAMENTO PIX CONFIRMADO"
        );

        console.log(
            "PIX:",
            pagamentoId
        );

        console.log(
            "Cliente:",
            sessao.cliente.nome
        );

        console.log(
            "================================"
        );

        // ====================================================
        // AVISA CLIENTE
        // ====================================================

        await enviarMensagem(
            client,
            chatId,

            "✅ *Pagamento confirmado!*\n\n" +

            "Seu PIX foi recebido com sucesso. 💳\n\n" +

            "Agora vamos enviar seu pedido para a loja. 🍦"
        );

        // ====================================================
        // ENVIA PEDIDO PARA LOJA
        // ====================================================

        await enviarPedidoParaLoja(
            client,
            chatId,
            sessao
        );

        // ====================================================
        // FINALIZA
        // ====================================================

        sessao.etapa =
            "finalizado";

        pagamentosPendentes.delete(
            pagamentoId
        );

    } catch (err) {

        console.error(
            "================================"
        );

        console.error(
            "❌ ERRO AO PROCESSAR PAGAMENTO"
        );

        console.error(err);

        console.error(
            "================================"
        );
    }
}

// ============================================================
// ENVIAR PEDIDO PARA LOJA
// ============================================================

async function enviarPedidoParaLoja(
    client,
    chatId,
    sessao
) {

    const total =
        totalPedido(
            sessao.pedido
        );

    const c =
        sessao.cliente;

    const numeroCliente =
        chatId.replace(
            "@c.us",
            ""
        );

    const mensagemLoja =

        "🍦 *NOVO PEDIDO*\n\n" +

        `Cliente: ${c.nome}\n` +

        `WhatsApp: ${numeroCliente}\n` +

        `Aniversário: ${
            c.aniversario ||
            "não informado"
        }\n` +

        `Endereço: ${c.endereco}\n` +

        `Pagamento: ${c.pagamento}\n` +

        "Status: PAGO ✅\n\n" +

        "Itens:\n" +

        resumoPedido(
            sessao.pedido
        ) +

        "\n\n" +

        `*Total: R$ ${total.toFixed(2)}*`;

    const chatLoja =
        `${NUMERO_LOJA}@c.us`;

    await enviarMensagem(
        client,
        chatLoja,
        mensagemLoja
    );

    console.log(
        "✅ Pedido enviado para a loja."
    );
}

// ============================================================
// FINALIZAR PEDIDO - PAGAMENTO NA ENTREGA
// ============================================================

async function finalizarPedido(
    client,
    chatId,
    sessao
) {

    try {

        if (
            !sessao.pedido ||
            sessao.pedido.length === 0
        ) {

            throw new Error(
                "Pedido sem itens."
            );
        }

        const c =
            sessao.cliente;

        if (!c.nome) {

            throw new Error(
                "Cliente sem nome."
            );
        }

        if (!c.endereco) {

            throw new Error(
                "Cliente sem endereço."
            );
        }

        if (!c.pagamento) {

            throw new Error(
                "Pagamento não definido."
            );
        }

        // ====================================================
        // ENVIA PARA LOJA
        // ====================================================

        await enviarPedidoParaLoja(
            client,
            chatId,
            sessao
        );

        const total =
            totalPedido(
                sessao.pedido
            );

        await enviarMensagem(
            client,
            chatId,

            "✅ *Pedido confirmado!*\n\n" +

            resumoPedido(
                sessao.pedido
            ) +

            "\n\n" +

            `*Total: R$ ${total.toFixed(2)}*\n` +

            `Pagamento: ${c.pagamento}\n\n` +

            `Obrigado, ${c.nome}! ❤️\n\n` +

            "Já estamos preparando seu pedido. 🍦"
        );

        sessao.pedidoFinalizado =
            true;

        sessao.etapa =
            "finalizado";

        console.log(
            "✅ Pedido finalizado - pagamento na entrega."
        );

    } catch (err) {

        console.error(
            "❌ Erro ao finalizar pedido:"
        );

        console.error(err);

        try {

            await enviarMensagem(
                client,
                chatId,

                "Tivemos um problema ao finalizar seu pedido 😕\n\n" +

                "Por favor, tente novamente."
            );

        } catch (erroEnvio) {

            console.error(
                "❌ Não foi possível avisar o cliente:"
            );

            console.error(
                erroEnvio
            );
        }
    }
}

// ============================================================
// CLIENTE WHATSAPP
// ============================================================

const client =
    new Client({

        authStrategy:
            new LocalAuth(),

        puppeteer: {

            headless: true,

            args: [

                "--no-sandbox",

                "--disable-setuid-sandbox"

            ]

        }

    });

// ============================================================
// EVENTOS WHATSAPP
// ============================================================

client.on(
    "qr",
    qr => {

        console.log(
            "📱 Escaneie o QR Code:"
        );

        qrcode.generate(
            qr,
            {
                small: true
            }
        );
    }
);

client.on(
    "authenticated",
    () => {

        console.log(
            "🔐 WhatsApp autenticado."
        );
    }
);

client.on(
    "ready",
    () => {

        console.log(
            "================================"
        );

        console.log(
            "🍦 BOT DA SORVETERIA"
        );

        console.log(
            "✅ WhatsApp conectado!"
        );

        console.log(
            "================================"
        );
    }
);

client.on(
    "auth_failure",
    msg => {

        console.error(
            "❌ Falha na autenticação:"
        );

        console.error(msg);
    }
);

client.on(
    "disconnected",
    reason => {

        console.warn(
            "⚠️ WhatsApp desconectado."
        );

        console.warn(
            "Motivo:",
            reason
        );
    }
);

client.on(
    "change_state",
    state => {

        console.log(
            "📱 Estado:",
            state
        );
    }
);

client.on(
    "loading_screen",
    (percent, message) => {

        console.log(
            `⏳ WhatsApp: ${percent}% - ${message}`
        );
    }
);

// ============================================================
// RECEBIMENTO DE MENSAGENS
// ============================================================

client.on(
    "message",
    async msg => {

        try {

            // =================================================
            // DUPLICADA
            // =================================================

            if (
                mensagemJaProcessada(msg)
            ) {

                console.log(
                    "⚠️ Mensagem duplicada ignorada."
                );

                return;
            }

            // =================================================
            // GRUPOS
            // =================================================

            if (
                msg.from &&
                msg.from.endsWith("@g.us")
            ) {

                return;
            }

            // =================================================
            // IGNORA MENSAGEM DA PRÓPRIA LOJA
            // =================================================

            if (
                msg.from ===
                `${NUMERO_LOJA}@c.us`
            ) {

                return;
            }

            const chatId =
                msg.from;

            const texto =
                (
                    msg.body || ""
                ).trim();

            const sessao =
                getSessao(chatId);

            console.log(
                `📩 Mensagem [${msg.id?.id}]: "${texto}"`
            );

            await tratarMensagem(
                client,
                chatId,
                texto,
                sessao,
                msg
            );

        } catch (err) {

            console.error(
                "================================"
            );

            console.error(
                "❌ ERRO AO TRATAR MENSAGEM"
            );

            console.error(err);

            console.error(
                "================================"
            );

            try {

                await enviarMensagem(
                    client,
                    msg.from,

                    "Ops, tive um problema aqui 😅\n\n" +

                    "Não consegui processar sua mensagem.\n\n" +

                    "Tente novamente ou digite *cancelar*."
                );

            } catch (erroEnvio) {

                console.error(
                    "❌ Erro ao enviar mensagem de erro:"
                );

                console.error(
                    erroEnvio
                );
            }
        }
    }
);

// ============================================================
// MÁQUINA DE ESTADOS
// ============================================================

async function tratarMensagem(
    client,
    chatId,
    texto,
    sessao,
    msg
) {

    const textoLower =
        texto.toLowerCase();

    // ========================================================
    // CANCELAR
    // ========================================================

    if (
        textoLower === "cancelar" ||
        textoLower === "recomeçar" ||
        textoLower === "recomecar"
    ) {

        resetarSessao(
            chatId
        );

        await enviarMensagem(
            client,
            chatId,

            "Pedido cancelado. ❌\n\n" +

            "Digite qualquer mensagem " +
            "para começar novamente. 🍦"
        );

        return;
    }

    // ========================================================
    // ESTADOS
    // ========================================================

    switch (sessao.etapa) {

        // ====================================================
        // INÍCIO
        // ====================================================

        case "inicio": {

            await enviarMensagem(
                client,
                chatId,

                "Olá! Tudo bem? 🍦\n\n" +

                "Bem-vindo(a) à nossa sorveteria!\n\n" +

                "Segue nosso cardápio:"
            );

            // =================================================
            // CARDÁPIO EM IMAGEM
            // =================================================

            if (
                fs.existsSync(
                    CAMINHO_MENU
                )
            ) {

                try {

                    const media =
                        MessageMedia.fromFilePath(
                            CAMINHO_MENU
                        );

                    await enviarMensagem(
                        client,
                        chatId,
                        media,
                        {

                            caption:
                                "📋 *Nosso Cardápio* 🍦\n\n" +

                                "Escolha o número do item que deseja!"

                        }
                    );

                } catch (err) {

                    console.error(
                        "❌ Erro ao enviar cardápio:"
                    );

                    console.error(err);

                    await enviarMensagem(
                        client,
                        chatId,

                        "Não consegui enviar a imagem do cardápio 😕\n\n" +

                        formatarCardapio()
                    );
                }

            } else {

                await enviarMensagem(
                    client,
                    chatId,

                    "Cardápio em imagem indisponível 😕\n\n" +

                    formatarCardapio()
                );
            }

            // =================================================
            // INSTRUÇÕES
            // =================================================

            await enviarMensagem(
                client,
                chatId,

                "Digite o *número* do item que deseja.\n\n" +

                "Quando terminar, digite *fim*.\n\n" +

                "A qualquer momento digite *cancelar*."
            );

            sessao.etapa =
                "pedido";

            break;
        }

        // ====================================================
        // PEDIDO
        // ====================================================

        case "pedido": {

            // =================================================
            // FINALIZAR SELEÇÃO
            // =================================================

            if (
                textoLower === "fim"
            ) {

                if (
                    sessao.pedido.length === 0
                ) {

                    await enviarMensagem(
                        client,
                        chatId,

                        "Você ainda não escolheu nenhum item. 😅"
                    );

                    return;
                }

                await enviarMensagem(
                    client,
                    chatId,

                    "🧾 *Resumo do pedido*\n\n" +

                    resumoPedido(
                        sessao.pedido
                    ) +

                    "\n\n" +

                    `*Total: R$ ${totalPedido(sessao.pedido).toFixed(2)}*` +

                    "\n\n" +

                    "Qual é o seu *nome*?"
                );

                sessao.etapa =
                    "nome";

                return;
            }

            // =================================================
            // BUSCAR ITEM
            // =================================================

            const item =
                buscarItem(texto);

            if (!item) {

                await enviarMensagem(
                    client,
                    chatId,

                    "Não encontrei esse item 🤔\n\n" +

                    "Digite o número exatamente como aparece no cardápio.\n\n" +

                    "Ou digite *fim*."
                );

                return;
            }

            sessao.itemPendente =
                item;

            sessao.etapa =
                "quantidade";

            await enviarMensagem(
                client,
                chatId,

                `Quantas unidades de "${item.nome}" você quer?`
            );

            break;
        }

        // ====================================================
        // QUANTIDADE
        // ====================================================

        case "quantidade": {

            if (
                !/^\d+$/.test(texto)
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "Me manda apenas um número.\n\n" +

                    "Exemplo: *1*, *2* ou *3*."
                );

                return;
            }

            const qtd =
                Number(texto);

            if (
                qtd <= 0 ||
                qtd > 50
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "A quantidade deve estar entre *1 e 50*."
                );

                return;
            }

            const item =
                sessao.itemPendente;

            if (!item) {

                console.error(
                    "❌ Item pendente não encontrado."
                );

                sessao.etapa =
                    "pedido";

                await enviarMensagem(
                    client,
                    chatId,

                    "Tive um problema ao identificar o produto 😕\n\n" +

                    "Escolha novamente."
                );

                return;
            }

            sessao.pedido.push({

                ...item,

                quantidade:
                    qtd

            });

            sessao.itemPendente =
                null;

            sessao.etapa =
                "pedido";

            await enviarMensagem(
                client,
                chatId,

                "Adicionado ✅\n\n" +

                "Digite outro número do cardápio ou *fim*."
            );

            break;
        }

        // ====================================================
        // NOME
        // ====================================================

        case "nome": {

            if (
                texto.length < 2 ||
                texto.length > 100
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "Digite seu nome corretamente 😊\n\n" +

                    "O nome deve ter entre 2 e 100 caracteres."
                );

                return;
            }

            if (
                !/[a-zA-ZÀ-ÿ]/.test(texto)
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "O nome precisa conter letras 😊"
                );

                return;
            }

            sessao.cliente.nome =
                texto;

            sessao.etapa =
                "aniversario";

            await enviarMensagem(
                client,
                chatId,

                "Qual sua data de aniversário? 🎂\n\n" +

                "Formato: *dd/mm*\n\n" +

                "Exemplo: *15/03*\n\n" +

                "Se preferir não informar, digite *pular*."
            );

            break;
        }

        // ====================================================
        // ANIVERSÁRIO
        // ====================================================

        case "aniversario": {

            if (
                textoLower === "pular"
            ) {

                sessao.cliente.aniversario =
                    null;

            } else {

                if (
                    !validarAniversario(
                        texto
                    )
                ) {

                    await enviarMensagem(
                        client,
                        chatId,

                        "Data inválida 😅\n\n" +

                        "Use *dd/mm*.\n\n" +

                        "Exemplo: *15/03*."
                    );

                    return;
                }

                sessao.cliente.aniversario =
                    texto;
            }

            sessao.etapa =
                "endereco";

            await enviarMensagem(
                client,
                chatId,

                "Agora me manda o *endereço completo* para entrega. 📍"
            );

            break;
        }

        // ====================================================
        // ENDEREÇO
        // ====================================================

        case "endereco": {

            if (
                !texto ||
                texto.length < 5
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "Informe um endereço válido 📍\n\n" +

                    "Exemplo:\n" +

                    "Rua das Flores, 123 - Centro"
                );

                return;
            }

            if (
                texto.length > 250
            ) {

                await enviarMensagem(
                    client,
                    chatId,

                    "O endereço ficou muito grande 😅\n\n" +

                    "Máximo: 250 caracteres."
                );

                return;
            }

            sessao.cliente.endereco =
                texto;

            sessao.etapa =
                "pagamento";

            await enviarMensagem(
                client,
                chatId,

                "Qual a forma de pagamento? 💳\n\n" +

                "*1* - Pix\n" +

                "*2* - Pagar na entrega"
            );

            break;
        }

        // ====================================================
        // PAGAMENTO
        // ====================================================

        case "pagamento": {

            // =================================================
            // PIX
            // =================================================

            if (
                texto === "1"
            ) {

                sessao.cliente.pagamento =
                    "Pix";

                try {

                    await enviarMensagem(
                        client,
                        chatId,

                        "Só um momento... 💳\n\n" +

                        "Estou gerando seu pagamento PIX."
                    );

                    await enviarPix(
                        client,
                        chatId,
                        sessao
                    );

                } catch (err) {

                    console.error(
                        "❌ Erro ao gerar PIX:"
                    );

                    console.error(err);

                    sessao.etapa =
                        "pagamento";

                    await enviarMensagem(
                        client,
                        chatId,

                        "Não consegui gerar o PIX agora 😕\n\n" +

                        "Tente novamente escolhendo:\n\n" +

                        "*1* - Pix\n" +

                        "*2* - Pagar na entrega"
                    );
                }

            // =================================================
            // PAGAMENTO NA ENTREGA
            // =================================================

            } else if (
                texto === "2"
            ) {

                sessao.cliente.pagamento =
                    "Pagamento na entrega";

                await finalizarPedido(
                    client,
                    chatId,
                    sessao
                );

            } else {

                await enviarMensagem(
                    client,
                    chatId,

                    "Escolha uma opção válida:\n\n" +

                    "*1* - Pix\n" +

                    "*2* - Pagar na entrega"
                );
            }

            break;
        }

        // ====================================================
        // AGUARDANDO PIX
        // ====================================================

        case "aguardando_pix": {

            await enviarMensagem(
                client,
                chatId,

                "⏳ Ainda estou aguardando a confirmação do pagamento.\n\n" +

                "Assim que o PIX for confirmado, " +

                "seu pedido será enviado automaticamente para a loja. ✅"
            );

            break;
        }

        // ====================================================
        // PAGAMENTO CONFIRMADO
        // ====================================================

        case "pagamento_confirmado": {

            await enviarMensagem(
                client,
                chatId,

                "Seu pagamento já foi confirmado! ✅\n\n" +

                "Seu pedido está sendo preparado. 🍦"
            );

            break;
        }

        // ====================================================
        // FINALIZADO
        // ====================================================

        case "finalizado": {

            await enviarMensagem(
                client,
                chatId,

                "Seu pedido já está com a gente! 🍨\n\n" +

                "Se quiser fazer um novo pedido, " +

                "digite *recomeçar*."
            );

            break;
        }

        // ====================================================
        // ESTADO DESCONHECIDO
        // ====================================================

        default: {

            console.warn(
                `⚠️ Estado desconhecido: ${sessao.etapa}`
            );

            resetarSessao(
                chatId
            );

            await enviarMensagem(
                client,
                chatId,

                "Vamos começar de novo! 🍦\n\n" +

                "Digite qualquer mensagem para iniciar."
            );
        }
    }
}

// ============================================================
// EXPRESS
// ============================================================

const app =
    express();

// ============================================================
// WEBHOOK ABACATEPAY
// ============================================================

// IMPORTANTE:
//
// express.raw() precisa ser usado neste endpoint
// antes de qualquer parser JSON.
//
// A assinatura HMAC é calculada sobre o corpo RAW.
//
// ============================================================

app.post(

    "/webhooks/abacatepay",

    express.raw({
        type: "application/json"
    }),

    async (req, res) => {

        try {

            // =================================================
            // SECRET DA URL
            // =================================================

            const secret =
                req.query.webhookSecret;

            if (
                secret !==
                ABACATEPAY_WEBHOOK_SECRET
            ) {

                console.warn(
                    "🚫 Webhook rejeitado: secret inválido."
                );

                return res
                    .status(401)
                    .json({
                        error:
                            "Unauthorized"
                    });
            }

            // =================================================
            // RAW BODY
            // =================================================

            if (
                !Buffer.isBuffer(req.body)
            ) {

                console.error(
                    "❌ Webhook não recebeu body RAW."
                );

                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid body"
                    });
            }

            const rawBody =
                req.body.toString(
                    "utf8"
                );

            // =================================================
            // ASSINATURA
            // =================================================

            const assinatura =
                req.headers[
                    "x-webhook-signature"
                ];

            if (
                !verificarAssinaturaWebhook(
                    rawBody,
                    assinatura
                )
            ) {

                console.warn(
                    "🚫 Webhook rejeitado: assinatura inválida."
                );

                return res
                    .status(401)
                    .json({
                        error:
                            "Invalid signature"
                    });
            }

            // =================================================
            // JSON
            // =================================================

            let evento;

            try {

                evento =
                    JSON.parse(
                        rawBody
                    );

            } catch (err) {

                console.error(
                    "❌ JSON do webhook inválido."
                );

                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid JSON"
                    });
            }

            console.log(
                "================================"
            );

            console.log(
                "📨 WEBHOOK ABACATEPAY"
            );

            console.log(
                "Evento:",
                evento.event
            );

            console.log(
                "ID:",
                evento.id
            );

            console.log(
                "================================"
            );

            // =================================================
            // ID DO EVENTO
            // =================================================

            if (!evento.id) {

                console.warn(
                    "⚠️ Webhook sem ID de evento."
                );

                return res
                    .status(400)
                    .json({
                        error:
                            "Event ID required"
                    });
            }

            // =================================================
            // IDEMPOTÊNCIA
            // =================================================

            if (
                eventoJaProcessado(
                    evento.id
                )
            ) {

                console.log(
                    "⚠️ Evento duplicado ignorado."
                );

                return res
                    .status(200)
                    .json({
                        received:
                            true
                    });
            }

            // =================================================
            // PIX PAGO
            // =================================================

            if (
                evento.event === "transparent.completed" ||
                evento.event === "billing.paid" ||
                evento.event === "checkout.completed"
            ) {

                await processarPagamentoConfirmado(
                    evento
                );

            } else {

                console.log(
                    "ℹ️ Evento não tratado:",
                    evento.event
                );
            }

            // =================================================
            // SUCESSO
            // =================================================

            return res
                .status(200)
                .json({
                    received:
                        true
                });

        } catch (err) {

            console.error(
                "================================"
            );

            console.error(
                "❌ ERRO NO WEBHOOK"
            );

            console.error(err);

            console.error(
                "================================"
            );

            return res
                .status(500)
                .json({
                    error:
                        "Internal server error"
                });
        }
    }
);

// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
    "/",
    (req, res) => {

        let whatsappStatus =
            "starting";

        try {

            if (
                client.info
            ) {

                whatsappStatus =
                    "connected";
            }

        } catch {
            whatsappStatus =
                "starting";
        }

        res.json({

            status:
                "online",

            bot:
                "sorveteria",

            whatsapp:
                whatsappStatus

        });
    }
);

// ============================================================
// TRATAMENTO DE ERROS DO EXPRESS
// ============================================================

app.use(
    (err, req, res, next) => {

        console.error(
            "❌ Erro no Express:"
        );

        console.error(err);

        if (
            res.headersSent
        ) {

            return next(err);
        }

        res
            .status(500)
            .json({
                error:
                    "Internal server error"
            });
    }
);

// ============================================================
// INICIALIZAÇÃO
// ============================================================

async function iniciar() {

    try {

        console.log(
            "================================"
        );

        console.log(
            "🚀 INICIANDO BOT"
        );

        console.log(
            "================================"
        );

        // ====================================================
        // CONFIGURAÇÃO
        // ====================================================

        validarConfiguracao();

        console.log(
            "✅ Configuração validada."
        );

        // ====================================================
        // CARDÁPIO
        // ====================================================

        verificarCardapio();

        // ====================================================
        // ABACATEPAY
        // ====================================================

        await inicializarAbacatePay();

        // ====================================================
        // EXPRESS
        // ====================================================

        app.listen(
            PORT,
            () => {

                console.log(
                    "🌐 Servidor webhook:"
                );

                console.log(
                    `http://localhost:${PORT}`
                );

                console.log(
                    `POST /webhooks/abacatepay`
                );
            }
        );

        // ====================================================
        // WHATSAPP
        // ====================================================

        await client.initialize();

    } catch (err) {

        console.error(
            "================================"
        );

        console.error(
            "❌ ERRO FATAL AO INICIAR BOT"
        );

        console.error(err);

        console.error(
            "================================"
        );

        process.exit(1);
    }
}

// ============================================================
// TRATAMENTO GLOBAL DE ERROS
// ============================================================

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ Unhandled Rejection:"
        );

        console.error(error);
    }
);

process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ Uncaught Exception:"
        );

        console.error(error);
    }
);

// ============================================================
// INICIAR
// ============================================================

iniciar();