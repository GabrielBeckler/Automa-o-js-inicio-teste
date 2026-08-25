# Bot de Atendimento — Sorveteria (WhatsApp)

Protótipo funcional de um chatbot de atendimento via WhatsApp para uma sorveteria.
Usa a biblioteca **whatsapp-web.js**, que conecta no WhatsApp Web (não precisa de
aprovação da API oficial da Meta — ótimo para prototipar rápido e barato).

## O que ele faz

1. Ao receber a primeira mensagem, se apresenta e envia o cardápio (texto, ou o
   arquivo `menu.pdf` se você colocar um nessa pasta).
2. Deixa o cliente escolher itens pelo número + quantidade, até digitar `fim`.
3. Faz o "cadastro" perguntando nome, aniversário (opcional) e endereço.
4. Pergunta a forma de pagamento (Pix ou na entrega). Se for Pix, envia a chave
   `31985807406` e espera confirmação/comprovante.
5. Envia o resumo do pedido para o próprio número da loja (`31985807406`), com
   nome, telefone, endereço, itens e total.
6. A qualquer momento o cliente pode digitar `cancelar` para recomeçar.

## Como rodar

**Pré-requisitos:** Node.js 18+ instalado e um número de WhatsApp dedicado à loja
(pode ser o mesmo `31999999999` mencionado no código).

```bash
# 1. instale as dependências
npm install

# 2. rode o bot
npm start
```

Na primeira execução vai aparecer um **QR code no terminal**. Escaneie com o
WhatsApp da loja (Configurações > Aparelhos conectados > Conectar um aparelho).
A sessão fica salva localmente (pasta `.wwebjs_auth`), então não precisa
escanear de novo nas próximas vezes.

Para testar: mande uma mensagem de outro número para o WhatsApp conectado e
siga o fluxo.

### Cardápio em PDF (opcional)
Se você colocar um arquivo `menu.pdf` na raiz do projeto, o bot envia esse PDF
junto com a saudação, além do texto. Se não existir, ele manda só o cardápio
em texto (editável em `cardapio.js`).

## Estrutura

```
sorveteria-bot/
├── index.js       # bot + máquina de estados da conversa
├── cardapio.js     # itens do cardápio (edite aqui preços/itens)
├── package.json
└── menu.pdf        # opcional — coloque o PDF do cardápio aqui
```

## Limitações deste protótipo (de propósito, para ficar simples)

- **Estado em memória**: se o processo reiniciar, todos os pedidos em
  andamento se perdem.
- **Um único item de cada vez**: o cliente escolhe item → quantidade → repete.
- **Confirmação de Pix é manual**: o bot não valida o comprovante de verdade,
  só aceita "ok" ou qualquer mídia enviada como confirmação.
- **whatsapp-web.js é uma lib não-oficial**: ela automatiza o WhatsApp Web via
  navegador headless. Funciona bem para prototipar e para volume pequeno/médio,
  mas há risco de bloqueio do número em uso muito agressivo, e não é o canal
  oficialmente suportado pela Meta para negócios.

## O que eu expandiria primeiro

1. **Persistência real** (SQLite ou Postgres) para pedidos e cadastro de
   clientes — hoje tudo é perdido ao reiniciar o processo. Isso também é o que
   habilita as "futuras automações" com data de aniversário (ex: cupom
   automático no dia).
2. **Migrar para a WhatsApp Cloud API oficial** (Meta) assim que o volume
   justificar — evita risco de bloqueio e permite recursos como botões
   interativos e listas nativas em vez de "digite o número".
3. **Carrinho com botões/lista** em vez de fluxo item-por-item digitado —
   a Cloud API oferece "menus" nativos que tornam a experiência bem mais
   rápida para o cliente.
4. **Painel simples para a loja** (mesmo que uma planilha ou dashboard web)
   ver os pedidos do dia, já que hoje eles só chegam como mensagem de texto.
5. **Validação de comprovante Pix** com integração a um provedor (Mercado
   Pago, Pix automático via banco) para confirmar o pagamento de verdade, sem
   depender do cliente avisar manualmente.
# Automa-o-js-inicio-teste
