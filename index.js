// index.js
// Bot de atendimento para sorveteria via WhatsApp (whatsapp-web.js).
//
// Fluxo:
// 1. Saudação inicial + envio do cardápio (texto e, se existir, PDF em ./menu.pdf)
// 2. Cliente monta o pedido digitando os números dos itens (um por vez, "fim" para encerrar)
// 3. Cadastro: nome, aniversário (opcional), endereço
// 4. Forma de pagamento: pix ou na entrega
//    - se pix, envia a chave e pede confirmação do comprovante
// 5. Resumo enviado ao próprio número da loja (WHATSAPP_LOJA)

const fs = require("fs");
const path = require("path");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { formatarCardapio, buscarItem } = require("./cardapio");

// ---------- CONFIGURAÇÃO ----------
// Número da loja (o mesmo que recebe o pedido final). Formato: DDI+DDD+numero, só dígitos.
const NUMERO_LOJA = "5531985807406";
const CHAVE_PIX = "31985807406";
const CAMINHO_PDF_MENU = path.join(__dirname, "menu.pdf"); // opcional

// ---------- ESTADO EM MEMÓRIA (por chat) ----------
// Em produção troque isso por um banco (SQLite/Redis/Postgres) — ver README, seção "Próximos passos".
const sessoes = new Map();

function novaSessao() {
  return {
    etapa: "inicio",
    pedido: [], // { id, nome, preco, quantidade }
    cliente: { nome: null, aniversario: null, endereco: null, pagamento: null },
  };
}

function getSessao(chatId) {
  if (!sessoes.has(chatId)) sessoes.set(chatId, nSessao());
  return sessoes.get(chatId);
}
ova
function resetarSessao(chatId) {
  sessoes.set(chatId, novaSessao());
}

function totalPedido(pedido) {
  return pedido.reduce((soma, item) => soma + item.preco * item.quantidade, 0);
}

function resumoPedido(pedido) {
  return pedido
    .map((i) => `- ${i.quantidade}x ${i.nome} (R$ ${(i.preco * i.quantidade).toFixed(2)})`)
    .join("\n");
}

// ---------- CLIENTE WHATSAPP ----------
const client = new Client({
  authStrategy: new LocalAuth(), // guarda a sessão localmente, não precisa escanear QR toda vez
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("Escaneie o QR code abaixo com o WhatsApp da sorveteria:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", () => {
  console.log("Bot da sorveteria conectado e pronto!");
});

client.on("message", async (msg) => {
  // Ignora mensagens de grupo e do próprio número da loja (evita loop ao receber o pedido)
  if (msg.from.endsWith("@g.us")) return;
  if (msg.from === `${NUMERO_LOJA}@c.us`) return;

  const chatId = msg.from;
  const texto = (msg.body || "").trim();
  const sessao = getSessao(chatId);

  try {
    await tratarMensagem(client, chatId, texto, sessao, msg);
  } catch (err) {
    console.error("Erro tratando mensagem:", err);
    await client.sendMessage(chatId, "Ops, tive um problema aqui 😅 pode repetir a última mensagem?");
  }
});

// ---------- MÁQUINA DE ESTADOS ----------
async function tratarMensagem(client, chatId, texto, sessao, msg) {
  const textoLower = texto.toLowerCase();

  // Comando universal para recomeçar
  if (textoLower === "cancelar" || textoLower === "recomeçar" || textoLower === "recomecar") {
    resetarSessao(chatId);
    await client.sendMessage(chatId, "Pedido cancelado. Digite qualquer mensagem para começar de novo. 🍦");
    return;
  }

  switch (sessao.etapa) {
    case "inicio": {
      await client.sendMessage(
        chatId,
        "Olá! Tudo bem? 🍦 Bem-vindo(a) à Sorveteria!\n\nO que você deseja hoje? Segue nosso cardápio:"
      );

      if (fs.existsSync(CAMINHO_PDF_MENU)) {
        const media = MessageMedia.fromFilePath(CAMINHO_PDF_MENU);
        await client.sendMessage(chatId, media, { caption: "📋 Cardápio" });
      } else {
        await client.sendMessage(chatId, formatarCardapio());
      }

      await client.sendMessage(
        chatId,
        'Digite o *número* do item que deseja, um de cada vez.\nQuando terminar, digite *fim*.\n(A qualquer momento digite *cancelar* para recomeçar.)'
      );
      sessao.etapa = "pedido";
      break;
    }

    case "pedido": {
      if (textoLower === "fim") {
        if (sessao.pedido.length === 0) {
          await client.sendMessage(chatId, "Você ainda não escolheu nenhum item. Digite o número de um item do cardápio.");
          return;
        }
        await client.sendMessage(
          chatId,
          `Show! Seu pedido até agora:\n${resumoPedido(sessao.pedido)}\n\nTotal: R$ ${totalPedido(sessao.pedido).toFixed(2)}\n\nAgora preciso de alguns dados. Qual é o seu *nome*?`
        );
        sessao.etapa = "nome";
        return;
      }

      const item = buscarItem(texto);
      if (!item) {
        await client.sendMessage(chatId, "Não encontrei esse item 🤔 digite o número exatamente como aparece no cardápio, ou *fim* para encerrar o pedido.");
        return;
      }

      sessao.etapa = "quantidade";
      sessao._itemPendente = item;
      await client.sendMessage(chatId, `Quantas unidades de "${item.nome}" você quer?`);
      break;
    }

    case "quantidade": {
      const qtd = parseInt(texto, 10);
      if (!qtd || qtd <= 0) {
        await client.sendMessage(chatId, "Me manda só o número da quantidade, ex: 1, 2, 3...");
        return;
      }
      const item = sessao._itemPendente;
      sessao.pedido.push({ ...item, quantidade: qtd });
      sessao._itemPendente = null;
      sessao.etapa = "pedido";
      await client.sendMessage(
        chatId,
        `Adicionado ✅\nDigite outro número do cardápio para adicionar mais itens, ou *fim* para fechar o pedido.`
      );
      break;
    }

    case "nome": {
      sessao.cliente.nome = texto;
      sessao.etapa = "aniversario";
      await client.sendMessage(
        chatId,
        "Qual sua data de aniversário? (formato dd/mm, ex: 15/03)\nSe preferir não informar, digite *pular*. Isso é só para futuras promoções 🎂"
      );
      break;
    }

    case "aniversario": {
      sessao.cliente.aniversario = textoLower === "pular" ? null : texto;
      sessao.etapa = "endereco";
      await client.sendMessage(chatId, "Agora me manda o *endereço completo* para entrega (rua, número, bairro e referência).");
      break;
    }

    case "endereco": {
      sessao.cliente.endereco = texto;
      sessao.etapa = "pagamento";
      await client.sendMessage(
        chatId,
        "Qual a forma de pagamento?\n*1* - Pix\n*2* - Pagar na entrega"
      );
      break;
    }

    case "pagamento": {
      if (texto === "1") {
        sessao.cliente.pagamento = "Pix";
        sessao.etapa = "aguardando_pix";
        await client.sendMessage(
          chatId,
          `Chave Pix: *${CHAVE_PIX}*\n\nApós o pagamento, me envie o comprovante (foto ou "ok" para confirmar) que eu já encaminho seu pedido! 🙌`
        );
      } else if (texto === "2") {
        sessao.cliente.pagamento = "Pagamento na entrega";
        await finalizarPedido(client, chatId, sessao);
      } else {
        await client.sendMessage(chatId, "Escolha uma opção válida: digite *1* para Pix ou *2* para pagar na entrega.");
      }
      break;
    }

    case "aguardando_pix": {
      // Aceita qualquer confirmação: texto "ok" ou uma mídia (comprovante em foto/pdf)
      if (msg.hasMedia || textoLower === "ok" || textoLower === "pago" || textoLower === "enviado") {
        await finalizarPedido(client, chatId, sessao);
      } else {
        await client.sendMessage(chatId, 'Assim que pagar, me envie o comprovante ou digite *ok* para eu confirmar seu pedido.');
      }
      break;
    }

    case "finalizado": {
      await client.sendMessage(
        chatId,
        "Seu pedido já está com a gente! 🍨 Se quiser fazer um novo pedido, digite *recomeçar*."
      );
      break;
    }

    default: {
      resetarSessao(chatId);
      await client.sendMessage(chatId, "Vamos começar de novo! Digite qualquer mensagem. 🍦");
    }
  }
}

async function finalizarPedido(client, chatId, sessao) {
  const total = totalPedido(sessao.pedido);
  const c = sessao.cliente;

  const mensagemCliente =
    `Pedido confirmado! ✅\n\n${resumoPedido(sessao.pedido)}\n\n` +
    `Total: R$ ${total.toFixed(2)}\n` +
    `Pagamento: ${c.pagamento}\n\n` +
    `Obrigado, ${c.nome}! Já estamos preparando seu pedido. 🍦`;

  await client.sendMessage(chatId, mensagemCliente);

  // Monta e envia o pedido para o número da loja
  const numeroClienteFormatado = chatId.replace("@c.us", "");
  const mensagemLoja =
    `🍦 *NOVO PEDIDO*\n\n` +
    `Cliente: ${c.nome}\n` +
    `WhatsApp: ${numeroClienteFormatado}\n` +
    `Aniversário: ${c.aniversario || "não informado"}\n` +
    `Endereço: ${c.endereco}\n` +
    `Pagamento: ${c.pagamento}\n\n` +
    `Itens:\n${resumoPedido(sessao.pedido)}\n\n` +
    `*Total: R$ ${total.toFixed(2)}*`;

  await client.sendMessage(`${NUMERO_LOJA}@c.us`, mensagemLoja);

  sessao.etapa = "finalizado";
}

client.initialize();
