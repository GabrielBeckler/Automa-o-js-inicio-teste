
// ============================================================
// CONEXÃO COM MYSQL
// ============================================================

const mysql = require("mysql2/promise");

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",

    port: Number(
        process.env.DB_PORT || 3306
    ),

    user: process.env.DB_USER,

    password: process.env.DB_PASSWORD,

    database: process.env.DB_NAME,

    waitForConnections: true,

    connectionLimit: 10,

    queueLimit: 0,

    charset: "utf8mb4",

    dateStrings: true
});


// ============================================================
// TESTAR CONEXÃO
// ============================================================

async function testarConexao() {

    let conexao;

    try {

        conexao =
            await pool.getConnection();

        console.log(
            "🗄️ [MySQL] Banco conectado com sucesso."
        );

    } catch (err) {

        console.error(
            "❌ [MySQL] Erro ao conectar:",
            err.message
        );

        throw err;

    } finally {

        if (conexao) {
            conexao.release();
        }
    }
}


module.exports = {
    pool,
    testarConexao
};
