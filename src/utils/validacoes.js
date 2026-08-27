// ============================================================
// VALIDAÇÕES DE ENTRADA DO USUÁRIO
// ============================================================

/**
 * Valida a data de aniversário no formato dd/mm.
 * @param {string} data - String no formato dd/mm.
 * @returns {boolean}
 */
function validarAniversario(data) {
    if (typeof data !== "string" || !/^\d{2}\/\d{2}$/.test(data)) {
        return false;
    }

    const [dia, mes] = data.split("/").map(Number);
    if (mes < 1 || mes > 12) {
        return false;
    }

    const diasPorMes = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (dia < 1 || dia > diasPorMes[mes - 1]) {
        return false;
    }

    return true;
}

/**
 * Valida se o nome informado possui tamanho adequado e contém letras.
 * @param {string} nome - Nome do cliente.
 * @returns {{ valido: boolean, motivo?: string }}
 */
function validarNome(nome) {
    if (!nome || typeof nome !== "string") {
        return { valido: false, motivo: "Nome vazio ou inválido." };
    }

    const trimmed = nome.trim();
    if (trimmed.length < 2 || trimmed.length > 100) {
        return { valido: false, motivo: "O nome deve ter entre 2 e 100 caracteres." };
    }

    if (!/[a-zA-ZÀ-ÿ]/.test(trimmed)) {
        return { valido: false, motivo: "O nome precisa conter letras." };
    }

    return { valido: true };
}

/**
 * Valida o endereço de entrega.
 * @param {string} endereco - Endereço informado.
 * @returns {{ valido: boolean, motivo?: string }}
 */
function validarEndereco(endereco) {
    if (!endereco || typeof endereco !== "string") {
        return { valido: false, motivo: "Endereço não informado." };
    }

    const trimmed = endereco.trim();
    if (trimmed.length < 5) {
        return { valido: false, motivo: "Informe um endereço completo com pelo menos 5 caracteres." };
    }

    if (trimmed.length > 250) {
        return { valido: false, motivo: "O endereço ficou muito longo (máximo de 250 caracteres)." };
    }

    return { valido: true };
}

/**
 * Valida a quantidade de itens do pedido (número inteiro entre 1 e 50).
 * @param {string} texto - Texto digitado pelo cliente.
 * @returns {{ valido: boolean, quantidade?: number, motivo?: string }}
 */
function validarQuantidade(texto) {
    if (!texto || typeof texto !== "string" || !/^\d+$/.test(texto.trim())) {
        return { valido: false, motivo: "Envie apenas números inteiros (ex: 1, 2 ou 3)." };
    }

    const qtd = Number(texto.trim());
    if (qtd <= 0 || qtd > 50) {
        return { valido: false, motivo: "A quantidade deve estar entre 1 e 50 unidades." };
    }

    return { valido: true, quantidade: qtd };
}

module.exports = {
    validarAniversario,
    validarNome,
    validarEndereco,
    validarQuantidade
};
