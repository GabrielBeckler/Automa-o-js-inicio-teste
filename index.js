// index.js
// Bot de atendimento para sorveteria via WhatsApp (whatsapp-web.js).

// Fluxo:
// 1. Saudação inicial + envio do cardápio
// 2. Cliente monta o pedido digitando os números dos itens
// 3. Cadastro: nome, aniversário (opcional), endereço
// 4. Forma de pagamento: Pix ou pagamento na entrega
// 5. Resumo enviado para o número da loja

require("dotenv").config();

const fs = require("fs");
const path = require("path");

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

// Número da loja.
// Formato: DDI + DDD + número, somente números.
// Exemplo: 5531999999999
const NUMERO_LOJA = process.env.NUMERO_LOJA;

// Chave Pix
const CHAVE_PIX = process.env.CHAVE_PIX;

// Caminho da imagem do cardápio
const CAMINHO_MENU = path.resolve(
    __dirname,
    "img/menu/menu.png"
);

const NUMERO_TESTE = process.env.NUMERO_TESTE;

// ============================================================
// VALIDAÇÃO DA CONFIGURAÇÃO
// ============================================================

if (!NUMERO_LOJA) {
    throw new Error(
        "NUMERO_LOJA não foi configurado no arquivo .env"
    );
}

if (!/^\d+$/.test(NUMERO_LOJA)) {
    throw new Error(
        "NUMERO_LOJA deve conter apenas números."
    );
}

if (!CHAVE_PIX || CHAVE_PIX.trim() === "") {
    throw new Error(
        "CHAVE_PIX não foi configurada no arquivo .env"
    );
}

if (!NUMERO_TESTE) {
    throw new Error(
        "NUMERO_TESTE não foi configurado no arquivo .env"
    );
}

if (!/^\d+$/.test(NUMERO_TESTE)) {
    throw new Error(
        "NUMERO_TESTE deve conter apenas números."
    );
}

// Verifica o cardápio apenas como aviso.
// O bot consegue continuar usando o cardápio em texto.
if (!fs.existsSync(CAMINHO_MENU)) {
    console.warn(
        "⚠️ Cardápio em imagem não encontrado:"
    );

    console.warn(CAMINHO_MENU);

    console.warn(
        "O bot continuará usando o cardápio em texto."
    );
}


// ============================================================
// ESTADO EM MEMÓRIA
// ============================================================

// Em produção, o ideal é utilizar banco de dados.
// Por enquanto, as sessões ficam em memória.

const sessoes = new Map();

// Guarda os IDs das mensagens já processadas
const mensagensProcessadas = new Map();

// Tempo que vamos manter o ID na memória
const TEMPO_EXPIRACAO_MENSAGEM = 5 * 60 * 1000; // 5 minutos

// ============================================================
// SESSÃO
// ============================================================

function esperar(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function atrasoAleatorio(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}

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

        _itemPendente: null
    };
}


function getSessao(chatId) {
    if (!sessoes.has(chatId)) {
        sessoes.set(chatId, novaSessao());
    }

    return sessoes.get(chatId);
}


function resetarSessao(chatId) {
    sessoes.set(chatId, novaSessao());
}

function mensagemJaProcessada(msg) {
    const id = msg?.id?.id;

    if (!id) {
        return false;
    }

    const agora = Date.now();

    // Remove IDs antigos
    for (const [mensagemId, timestamp] of mensagensProcessadas) {
        if (
            agora - timestamp >
            TEMPO_EXPIRACAO_MENSAGEM
        ) {
            mensagensProcessadas.delete(mensagemId);
        }
    }

    // Se já processamos essa mensagem
    if (mensagensProcessadas.has(id)) {
        return true;
    }

    // Marca como processada
    mensagensProcessadas.set(id, agora);

    return false;
}

// ============================================================
// PEDIDO
// ============================================================

function totalPedido(pedido) {
    return pedido.reduce(
        (soma, item) =>
            soma + item.preco * item.quantidade,
        0
    );
}


function resumoPedido(pedido) {
    if (!pedido || pedido.length === 0) {
        return "Nenhum item no pedido.";
    }

    return pedido
        .map(
            (item) =>
                `- ${item.quantidade}x ${item.nome} ` +
                `(R$ ${(item.preco * item.quantidade).toFixed(2)})`
        )
        .join("\n");
}


// ============================================================
// VALIDAÇÕES
// ============================================================

function validarAniversario(data) {

    // Formato obrigatório: dd/mm
    if (!/^\d{2}\/\d{2}$/.test(data)) {
        return false;
    }

    const [dia, mes] = data
        .split("/")
        .map(Number);

    if (mes < 1 || mes > 12) {
        return false;
    }

    const diasPorMes = [
        31, // janeiro
        29, // fevereiro
        31, // março
        30, // abril
        31, // maio
        30, // junho
        31, // julho
        31, // agosto
        30, // setembro
        31, // outubro
        30, // novembro
        31  // dezembro
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
// ENVIO SEGURO DE MENSAGENS
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
                "Cliente do WhatsApp não está disponível."
            );
        }

        if (!chatId) {
            throw new Error(
                "Chat ID não informado."
            );
        }

        const atraso = atrasoAleatorio(
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
// CLIENTE WHATSAPP
// ============================================================

const client = new Client({

    authStrategy: new LocalAuth(),

    puppeteer: {
        headless: true,
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox"
        ]
    }

});


// ============================================================
// EVENTOS DO WHATSAPP
// ============================================================

client.on("qr", (qr) => {

    console.log(
        "📱 Escaneie o QR Code abaixo com o WhatsApp da sorveteria:"
    );

    qrcode.generate(
        qr,
        {
            small: true
        }
    );
});


client.on("authenticated", () => {

    console.log(
        "🔐 WhatsApp autenticado com sucesso."
    );
});


client.on("ready", () => {

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
});


client.on("auth_failure", (msg) => {

    console.error(
        "❌ Falha na autenticação do WhatsApp:"
    );

    console.error(msg);
});


client.on("disconnected", (reason) => {

    console.warn(
        "⚠️ WhatsApp foi desconectado."
    );

    console.warn(
        "Motivo:",
        reason
    );
});


client.on("change_state", (state) => {

    console.log(
        "📱 Estado do WhatsApp:",
        state
    );
});


client.on(
    "loading_screen",
    (percent, message) => {

        console.log(
            `⏳ Carregando WhatsApp: ${percent}% - ${message}`
        );
    }
);


// ============================================================
// RECEBIMENTO DE MENSAGENS
// ============================================================

client.on("message", async (msg) => {
    try {

        // ================================================
        // IGNORA MENSAGENS DUPLICADAS
        // ================================================

        if (mensagemJaProcessada(msg)) {
            console.log(
                `⚠️ Mensagem duplicada ignorada: ${msg.id?.id}`
            );

            return;
        }


        // ================================================
        // IGNORA GRUPOS
        // ================================================

        if (
            msg.from &&
            msg.from.endsWith("@g.us")
        ) {
            return;
        }


        // ================================================
        // IGNORA MENSAGENS DA PRÓPRIA LOJA
        // ================================================

        if (
            msg.from ===
            `${NUMERO_LOJA}@c.us`
        ) {
            return;
        }

        // ================================================
        // MODO TESTE
        // SOMENTE O NUMERO_TESTE PODE USAR O BOT
        // ================================================

  //      if (msg.from !== `${NUMERO_TESTE}@c.us`) {
  //          console.log(
   //             `🚫 Mensagem ignorada de número não autorizado: ${msg.from}`
   //         );
//
     //       return;
    //    }

        const chatId = msg.from;

        const texto = (
            msg.body || ""
        ).trim();

        const sessao = getSessao(chatId);


        console.log(
            `📩 Mensagem recebida [${msg.id?.id}]: "${texto}"`
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

        console.error(
            "Chat:",
            msg?.from
        );

        console.error(
            "Mensagem:",
            msg?.body
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
                "Tente novamente ou digite *cancelar* " +
                "para começar de novo."
            );

        } catch (erroEnvio) {

            console.error(
                "❌ Não foi possível enviar a mensagem de erro:"
            );

            console.error(
                erroEnvio
            );
        }
    }
});


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

    const textoLower = texto.toLowerCase();


    // ========================================================
    // COMANDOS UNIVERSAIS
    // ========================================================

    if (
        textoLower === "cancelar" ||
        textoLower === "recomeçar" ||
        textoLower === "recomecar"
    ) {

        resetarSessao(chatId);

        await enviarMensagem(
            client,
            chatId,
            "Pedido cancelado. ❌\n\n" +
            "Digite qualquer mensagem para começar novamente. 🍦"
        );

        return;
    }


    // ========================================================
    // MÁQUINA DE ESTADOS
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


            // -----------------------------------------------
            // ENVIO DO CARDÁPIO
            // -----------------------------------------------

            if (
                fs.existsSync(CAMINHO_MENU)
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
                        "❌ Erro ao enviar imagem do cardápio:"
                    );

                    console.error(err);


                    // Fallback para texto
                    await enviarMensagem(
                        client,
                        chatId,
                        "Não consegui enviar a imagem do cardápio 😕\n\n" +
                        "Mas você pode escolher pelos itens abaixo:\n\n" +
                        formatarCardapio()
                    );
                }


            } else {

                console.warn(
                    "⚠️ Imagem do cardápio não encontrada."
                );


                await enviarMensagem(
                    client,
                    chatId,
                    "Não consegui encontrar a imagem do cardápio 😕\n\n" +
                    "Mas você pode escolher pelos itens abaixo:\n\n" +
                    formatarCardapio()
                );
            }


            await enviarMensagem(
                client,
                chatId,
                "Digite o *número* do item que deseja, " +
                "um de cada vez.\n\n" +
                "Quando terminar, digite *fim*.\n\n" +
                "A qualquer momento digite *cancelar* " +
                "para recomeçar."
            );


            sessao.etapa = "pedido";

            break;
        }


        // ====================================================
        // PEDIDO
        // ====================================================

        case "pedido": {

            // -----------------------------------------------
            // FINALIZAR ESCOLHA DOS PRODUTOS
            // -----------------------------------------------

            if (textoLower === "fim") {

                if (
                    sessao.pedido.length === 0
                ) {

                    await enviarMensagem(
                        client,
                        chatId,
                        "Você ainda não escolheu nenhum item. 😅\n\n" +
                        "Digite o número de um item do cardápio."
                    );

                    return;
                }


                await enviarMensagem(
                    client,
                    chatId,
                    "🧾 *Resumo do pedido*\n\n" +
                    resumoPedido(sessao.pedido) +
                    "\n\n" +
                    `*Total: R$ ${totalPedido(
                        sessao.pedido
                    ).toFixed(2)}*` +
                    "\n\n" +
                    "Agora preciso de alguns dados.\n\n" +
                    "Qual é o seu *nome*?"
                );


                sessao.etapa = "nome";

                return;
            }


            // -----------------------------------------------
            // BUSCAR PRODUTO
            // -----------------------------------------------

            const item = buscarItem(texto);


            if (!item) {

                await enviarMensagem(
                    client,
                    chatId,
                    "Não encontrei esse item 🤔\n\n" +
                    "Digite o número exatamente como aparece " +
                    "no cardápio.\n\n" +
                    "Ou digite *fim* para encerrar o pedido."
                );

                return;
            }


            // Guarda produto temporariamente
            sessao._itemPendente = item;

            sessao.etapa = "quantidade";


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

            // Somente números inteiros
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


            const qtd = Number(texto);


            // Limite de quantidade
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


            // Proteção contra item inexistente
            const item =
                sessao._itemPendente;


            if (!item) {

                console.error(
                    "❌ Item pendente não encontrado."
                );


                sessao.etapa = "pedido";

                await enviarMensagem(
                    client,
                    chatId,
                    "Tive um problema ao identificar o produto 😕\n\n" +
                    "Escolha novamente um item do cardápio."
                );

                return;
            }


            // Adiciona ao pedido
            sessao.pedido.push({
                ...item,
                quantidade: qtd
            });


            // Limpa item temporário
            sessao._itemPendente = null;

            sessao.etapa = "pedido";


            await enviarMensagem(
                client,
                chatId,
                "Adicionado ✅\n\n" +
                "Digite outro número do cardápio para adicionar " +
                "mais itens.\n\n" +
                "Ou digite *fim* para fechar o pedido."
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
                    "Digite seu nome corretamente, por favor 😊\n\n" +
                    "O nome deve ter entre 2 e 100 caracteres."
                );

                return;
            }


            // Precisa conter pelo menos uma letra
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


            sessao.cliente.nome = texto;

            sessao.etapa = "aniversario";


            await enviarMensagem(
                client,
                chatId,
                "Qual sua data de aniversário? 🎂\n\n" +
                "Formato: *dd/mm*\n" +
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
                    !validarAniversario(texto)
                ) {

                    await enviarMensagem(
                        client,
                        chatId,
                        "Data inválida 😅\n\n" +
                        "Use o formato *dd/mm*.\n\n" +
                        "Exemplo: *15/03*."
                    );

                    return;
                }


                sessao.cliente.aniversario =
                    texto;
            }


            sessao.etapa = "endereco";


            await enviarMensagem(
                client,
                chatId,
                "Agora me manda o *endereço completo* " +
                "para entrega. 📍"
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
                    "Por favor, informe um endereço válido 📍\n\n" +
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
                    "Tente enviar um endereço de até 250 caracteres."
                );

                return;
            }


            sessao.cliente.endereco =
                texto;

            sessao.etapa = "pagamento";


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

            // -----------------------------------------------
            // PIX
            // -----------------------------------------------

            if (texto === "1") {

                sessao.cliente.pagamento =
                    "Pix";

                sessao.etapa =
                    "aguardando_pix";


                await enviarMensagem(
                    client,
                    chatId,
                    `💳 *Pagamento via Pix*\n\n` +
                    `Chave Pix: *${CHAVE_PIX}*\n\n` +
                    "Após realizar o pagamento, envie o " +
                    "comprovante ou digite *ok* para confirmar."
                );


            // -----------------------------------------------
            // PAGAMENTO NA ENTREGA
            // -----------------------------------------------

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

            if (
                msg.hasMedia ||
                textoLower === "ok" ||
                textoLower === "pago" ||
                textoLower === "enviado"
            ) {

                await finalizarPedido(
                    client,
                    chatId,
                    sessao
                );

            } else {

                await enviarMensagem(
                    client,
                    chatId,
                    "Assim que realizar o pagamento, " +
                    "me envie o comprovante 📸\n\n" +
                    "Ou digite *ok* para confirmar."
                );
            }


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
// FINALIZAR PEDIDO
// ============================================================

async function finalizarPedido(
    client,
    chatId,
    sessao
) {

    try {

        // -----------------------------------------------
        // VALIDAÇÕES
        // -----------------------------------------------

        if (
            !sessao.pedido ||
            sessao.pedido.length === 0
        ) {

            throw new Error(
                "Tentativa de finalizar pedido sem itens."
            );
        }


        const total =
            totalPedido(
                sessao.pedido
            );


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
                "Forma de pagamento não definida."
            );
        }


        // -----------------------------------------------
        // NÚMERO DO CLIENTE
        // -----------------------------------------------

        const numeroClienteFormatado =
            chatId.replace(
                "@c.us",
                ""
            );


        // -----------------------------------------------
        // MENSAGEM PARA A LOJA
        // -----------------------------------------------

        const mensagemLoja =
            `🍦 *NOVO PEDIDO*\n\n` +
            `Cliente: ${c.nome}\n` +
            `WhatsApp: ${numeroClienteFormatado}\n` +
            `Aniversário: ${
                c.aniversario ||
                "não informado"
            }\n` +
            `Endereço: ${c.endereco}\n` +
            `Pagamento: ${c.pagamento}\n\n` +
            `Itens:\n` +
            `${resumoPedido(
                sessao.pedido
            )}\n\n` +
            `*Total: R$ ${total.toFixed(2)}*`;


        // -----------------------------------------------
        // PRIMEIRO ENVIA PARA A LOJA
        // -----------------------------------------------

        try {

            await enviarMensagem(
                client,
                `${NUMERO_LOJA}@c.us`,
                mensagemLoja
            );


        } catch (err) {

            console.error(
                "❌ ERRO CRÍTICO:"
            );

            console.error(
                "O pedido NÃO foi enviado para a loja."
            );

            console.error(err);


            await enviarMensagem(
                client,
                chatId,
                "Seu pedido ainda não pôde ser confirmado 😕\n\n" +
                "Tivemos um problema de comunicação com a loja.\n\n" +
                "Por favor, tente novamente em alguns instantes."
            );


            return;
        }


        // -----------------------------------------------
        // AGORA CONFIRMA PARA O CLIENTE
        // -----------------------------------------------

        const mensagemCliente =
            `Pedido confirmado! ✅\n\n` +
            `${resumoPedido(
                sessao.pedido
            )}\n\n` +
            `Total: R$ ${total.toFixed(2)}\n` +
            `Pagamento: ${c.pagamento}\n\n` +
            `Obrigado, ${c.nome}! ❤️\n\n` +
            `Já estamos preparando seu pedido. 🍦`;


        try {

            await enviarMensagem(
                client,
                chatId,
                mensagemCliente
            );


        } catch (err) {

            // Pedido já chegou na loja.
            // Portanto não devemos cancelar o pedido.

            console.error(
                "⚠️ Pedido enviado para a loja, " +
                "mas não foi possível enviar a confirmação ao cliente."
            );

            console.error(err);
        }


        // -----------------------------------------------
        // FINALIZA SESSÃO
        // -----------------------------------------------

        sessao.etapa =
            "finalizado";


        console.log(
            "================================"
        );

        console.log(
            "✅ PEDIDO FINALIZADO"
        );

        console.log(
            `Cliente: ${c.nome}`
        );

        console.log(
            `WhatsApp: ${numeroClienteFormatado}`
        );

        console.log(
            `Total: R$ ${total.toFixed(2)}`
        );

        console.log(
            "================================"
        );


    } catch (err) {

        console.error(
            "================================"
        );

        console.error(
            "❌ ERRO AO FINALIZAR PEDIDO"
        );

        console.error(err);

        console.error(
            "================================"
        );


        try {

            await enviarMensagem(
                client,
                chatId,
                "Tivemos um problema ao finalizar seu pedido 😕\n\n" +
                "Por favor, tente novamente."
            );

        } catch (erroEnvio) {

            console.error(
                "❌ Também não foi possível informar o cliente:"
            );

            console.error(
                erroEnvio
            );
        }
    }
}


// ============================================================
// INICIALIZAÇÃO
// ============================================================

client.initialize()
    .catch((err) => {

        console.error(
            "================================"
        );

        console.error(
            "❌ ERRO AO INICIAR O WHATSAPP"
        );

        console.error(err);

        console.error(
            "================================"
        );

        process.exit(1);
    });