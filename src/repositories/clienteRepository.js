const {
    pool
} = require("../config/database");


// ============================================================
// CREATE
// ============================================================

async function criarCliente({
    nome,
    telefone,
    aniversario = null,
    endereco = null,
    numero = null,
    complemento = null,
    bairro = null,
    cidade = null,
    referencia = null
}) {

    const sql = `
        INSERT INTO clientes (
            nome,
            telefone,
            aniversario,
            endereco,
            numero,
            complemento,
            bairro,
            cidade,
            referencia
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const [resultado] =
        await pool.execute(sql, [
            nome,
            telefone,
            aniversario,
            endereco,
            numero,
            complemento,
            bairro,
            cidade,
            referencia
        ]);

    return resultado.insertId;
}


// ============================================================
// READ — UM CLIENTE
// ============================================================

async function buscarClientePorId(id) {

    const sql = `
        SELECT *
        FROM clientes
        WHERE id = ?
    `;

    const [rows] =
        await pool.execute(sql, [id]);

    return rows[0] || null;
}


// ============================================================
// READ — TODOS
// ============================================================

async function listarClientes() {

    const sql = `
        SELECT *
        FROM clientes
        ORDER BY criado_em DESC
    `;

    const [rows] =
        await pool.execute(sql);

    return rows;
}


// ============================================================
// READ — POR TELEFONE
// ============================================================

async function buscarClientePorTelefone(
    telefone
) {

    const sql = `
        SELECT *
        FROM clientes
        WHERE telefone = ?
        LIMIT 1
    `;

    const [rows] =
        await pool.execute(sql, [
            telefone
        ]);

    return rows[0] || null;
}


// ============================================================
// UPDATE
// ============================================================

async function atualizarCliente(
    id,
    dados
) {

    const sql = `
        UPDATE clientes

        SET
            nome = ?,
            telefone = ?,
            aniversario = ?,
            endereco = ?,
            numero = ?,
            complemento = ?,
            bairro = ?,
            cidade = ?,
            referencia = ?

        WHERE id = ?
    `;

    const [resultado] =
        await pool.execute(sql, [
            dados.nome,
            dados.telefone,
            dados.aniversario,
            dados.endereco,
            dados.numero,
            dados.complemento,
            dados.bairro,
            dados.cidade,
            dados.referencia,
            id
        ]);

    return resultado.affectedRows;
}


// ============================================================
// DELETE
// ============================================================

async function excluirCliente(id) {

    const sql = `
        DELETE FROM clientes
        WHERE id = ?
    `;

    const [resultado] =
        await pool.execute(sql, [id]);

    return resultado.affectedRows;
}


// ============================================================
// EXPORTS
// ============================================================

module.exports = {
    criarCliente,
    buscarClientePorId,
    buscarClientePorTelefone,
    listarClientes,
    atualizarCliente,
    excluirCliente
};