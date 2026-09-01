// ============================================================
// PERSISTÊNCIA DE PEDIDOS, ITENS E PAGAMENTOS
// ============================================================

const crypto = require("crypto");
const { pool } = require("../config/database");
const { extrairNumeroWhatsApp } = require("../utils/helpers");
const { totalPedido } = require("../utils/formatadores");

function normalizarAniversario(aniversario) {
    if (!aniversario || !/^\d{2}\/\d{2}$/.test(aniversario)) return null;

    const [dia, mes] = aniversario.split("/");
    // O fluxo atual coleta apenas dia/mês. Um ano fixo permite preservar essa
    // informação em uma coluna DATE sem inventar a idade do cliente.
    return `2000-${mes}-${dia}`;
}

function obterFormaPagamento(pagamento) {
    const formas = { Pix: "PIX", Dinheiro: "DINHEIRO", "Cartão": "CARTAO" };
    const forma = formas[pagamento];
    if (!forma) throw new Error("Forma de pagamento inválida para persistência.");
    return forma;
}

function gerarCodigo(prefixo, tamanho) {
    return `${prefixo}${crypto.randomBytes(12).toString("hex")}`.slice(0, tamanho);
}

async function obterOuCriarCliente(conexao, { chatId, cliente }) {
    const telefone = extrairNumeroWhatsApp(chatId);
    if (!telefone) throw new Error("Não foi possível identificar o telefone do cliente.");

    const aniversario = normalizarAniversario(cliente.aniversario);
    const endereco = cliente.endereco === "Retirada no local" ? null : (cliente.endereco || null);
    const [existentes] = await conexao.execute(
        "SELECT id FROM clientes WHERE telefone = ? LIMIT 1",
        [telefone]
    );

    if (existentes.length) {
        const clienteId = existentes[0].id;
        await conexao.execute(
            `UPDATE clientes
             SET nome = ?, aniversario = COALESCE(?, aniversario), endereco = COALESCE(?, endereco)
             WHERE id = ?`,
            [cliente.nome, aniversario, endereco, clienteId]
        );
        return clienteId;
    }

    const [resultado] = await conexao.execute(
        "INSERT INTO clientes (nome, telefone, aniversario, endereco) VALUES (?, ?, ?, ?)",
        [cliente.nome, telefone, aniversario, endereco]
    );
    return resultado.insertId;
}

/**
 * Cria o pedido completo de forma atômica. Itens nunca ficam gravados sem o
 * respectivo pedido, nem um pedido sem seu pagamento inicial.
 */
async function criarPedido({ sessao, chatId, transacaoId = null, pagamentoStatus = "PENDENTE" }) {
    const itens = sessao.pedido;
    if (!Array.isArray(itens) || itens.length === 0) {
        throw new Error("Não é possível salvar um pedido sem itens.");
    }

    const conexao = await pool.getConnection();
    try {
        await conexao.beginTransaction();
        const clienteId = await obterOuCriarCliente(conexao, { chatId, cliente: sessao.cliente });
        const formaPagamento = obterFormaPagamento(sessao.cliente.pagamento);
        const tipoEntrega = sessao.cliente.endereco === "Retirada no local" ? "RETIRADA" : "ENTREGA";
        const total = Number(totalPedido(itens).toFixed(2));

        const [pedido] = await conexao.execute(
            `INSERT INTO pedidos (
                codigo, cliente_id, tipo_entrega, endereco_entrega, forma_pagamento,
                valor_total, dinheiro_recebido, troco, status, codigo_verificacao
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'NOVO', ?)`,
            [
                gerarCodigo("P", 20), clienteId, tipoEntrega,
                tipoEntrega === "ENTREGA" ? sessao.cliente.endereco : null,
                formaPagamento, total, sessao.cliente.dinheiroRecebido || null,
                sessao.cliente.troco || 0, gerarCodigo("V", 10)
            ]
        );

        for (const item of itens) {
            const quantidade = Number(item.quantidade);
            const preco = Number(item.preco);
            await conexao.execute(
                `INSERT INTO pedido_itens
                 (pedido_id, produto_id, nome_produto, preco_unitario, quantidade, subtotal)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [pedido.insertId, Number.isInteger(Number(item.id)) ? Number(item.id) : null,
                    item.nome, preco, quantidade, Number((preco * quantidade).toFixed(2))]
            );
        }

        await conexao.execute(
            "INSERT INTO pagamentos (pedido_id, metodo, status, valor, transacao_id) VALUES (?, ?, ?, ?, ?)",
            [pedido.insertId, formaPagamento, pagamentoStatus, total, transacaoId]
        );

        await conexao.commit();
        return pedido.insertId;
    } catch (erro) {
        await conexao.rollback();
        throw erro;
    } finally {
        conexao.release();
    }
}

async function atualizarPagamentoPorPedido(pedidoId, { status, transacaoId = null }) {
    const sql = transacaoId
        ? "UPDATE pagamentos SET status = ?, transacao_id = ? WHERE pedido_id = ?"
        : "UPDATE pagamentos SET status = ? WHERE pedido_id = ?";
    const valores = transacaoId ? [status, transacaoId, pedidoId] : [status, pedidoId];
    await pool.execute(sql, valores);
}

async function atualizarStatusPedido(pedidoId, status) {
    await pool.execute("UPDATE pedidos SET status = ? WHERE id = ?", [status, pedidoId]);
}

async function buscarPedidoPorTransacao(transacaoId) {
    const [pedidos] = await pool.execute(
        `SELECT p.*, c.nome AS cliente_nome, c.aniversario, c.endereco AS cliente_endereco,
                pg.id AS pagamento_id, pg.status AS pagamento_status, pg.transacao_id
         FROM pagamentos pg
         INNER JOIN pedidos p ON p.id = pg.pedido_id
         INNER JOIN clientes c ON c.id = p.cliente_id
         WHERE pg.transacao_id = ?
         LIMIT 1`,
        [transacaoId]
    );
    const pedido = pedidos[0];
    if (!pedido) return null;

    const [itens] = await pool.execute(
        `SELECT produto_id AS id, nome_produto AS nome, preco_unitario AS preco, quantidade
         FROM pedido_itens WHERE pedido_id = ? ORDER BY id`,
        [pedido.id]
    );
    return { ...pedido, itens };
}

module.exports = {
    criarPedido,
    atualizarPagamentoPorPedido,
    atualizarStatusPedido,
    buscarPedidoPorTransacao
};
