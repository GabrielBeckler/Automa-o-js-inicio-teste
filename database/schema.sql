CREATE DATABASE IF NOT EXISTS sorveteria
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE sorveteria;


-- ============================================================
-- USUÁRIOS / FUNCIONÁRIOS
-- ============================================================

CREATE TABLE usuarios (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    nome VARCHAR(100) NOT NULL,

    email VARCHAR(150) NOT NULL UNIQUE,

    senha_hash VARCHAR(255) NOT NULL,

    cargo ENUM(
        'ADMIN',
        'GERENTE',
        'FUNCIONARIO'
    ) NOT NULL DEFAULT 'FUNCIONARIO',

    ativo BOOLEAN NOT NULL DEFAULT TRUE,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
);


-- ============================================================
-- CLIENTES
-- ============================================================

CREATE TABLE clientes (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    nome VARCHAR(100) NOT NULL,

    telefone VARCHAR(30) NOT NULL UNIQUE,

    aniversario DATE NULL,

    endereco VARCHAR(255) NULL,

    numero VARCHAR(20) NULL,

    complemento VARCHAR(100) NULL,

    bairro VARCHAR(100) NULL,

    cidade VARCHAR(100) NULL,

    referencia VARCHAR(255) NULL,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_clientes_nome (nome),

    INDEX idx_clientes_telefone (telefone)
);


-- ============================================================
-- PRODUTOS / CARDÁPIO
-- ============================================================

CREATE TABLE produtos (
    id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    nome VARCHAR(150) NOT NULL,

    descricao TEXT NULL,

    preco DECIMAL(10,2) NOT NULL,

    imagem VARCHAR(255) NULL,

    disponivel BOOLEAN NOT NULL DEFAULT TRUE,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_produtos_disponivel (disponivel)
);


-- Produtos atualmente exibidos em cardapio.js. Os IDs são preservados para
-- que cada item de pedido possa manter a referência ao produto do catálogo.
INSERT INTO produtos (id, nome, preco) VALUES
    (1, 'Sorvete 500ml Leite Condensado c/ Leite em Pó', 22.00),
    (2, 'Sorvete 500ml Chocolate', 20.00),
    (3, 'Sorvete 500ml Morango', 20.00),
    (4, 'Sorvete 1L Napolitano', 32.00),
    (5, 'Picolé Unidade', 5.00),
    (6, 'Casquinha Simples', 7.00)
ON DUPLICATE KEY UPDATE
    nome = VALUES(nome),
    preco = VALUES(preco),
    disponivel = TRUE;


-- ============================================================
-- PEDIDOS
-- ============================================================

CREATE TABLE pedidos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    codigo VARCHAR(20) NOT NULL UNIQUE,

    cliente_id INT UNSIGNED NOT NULL,

    tipo_entrega ENUM(
        'ENTREGA',
        'RETIRADA'
    ) NOT NULL,

    endereco_entrega VARCHAR(255) NULL,

    numero_entrega VARCHAR(20) NULL,

    complemento_entrega VARCHAR(100) NULL,

    bairro_entrega VARCHAR(100) NULL,

    referencia_entrega VARCHAR(255) NULL,

    forma_pagamento ENUM(
        'PIX',
        'DINHEIRO',
        'CARTAO'
    ) NOT NULL,

    valor_total DECIMAL(10,2) NOT NULL DEFAULT 0.00,

    dinheiro_recebido DECIMAL(10,2) NULL,

    troco DECIMAL(10,2) NULL DEFAULT 0.00,

    status ENUM(
        'NOVO',
        'CONFIRMADO',
        'PREPARANDO',
        'PRONTO',
        'SAIU_ENTREGA',
        'ENTREGUE',
        'CANCELADO'
    ) NOT NULL DEFAULT 'NOVO',

    codigo_verificacao VARCHAR(10) NOT NULL UNIQUE,

    codigo_verificado BOOLEAN NOT NULL DEFAULT FALSE,

    codigo_verificado_em DATETIME NULL,

    observacoes TEXT NULL,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (cliente_id)
        REFERENCES clientes(id)
        ON DELETE RESTRICT
        ON UPDATE CASCADE,

    INDEX idx_pedidos_cliente (cliente_id),

    INDEX idx_pedidos_status (status),

    INDEX idx_pedidos_data (criado_em),

    INDEX idx_pedidos_codigo_verificacao (
        codigo_verificacao
    )
);


-- ============================================================
-- ITENS DO PEDIDO
-- ============================================================

CREATE TABLE pedido_itens (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    pedido_id BIGINT UNSIGNED NOT NULL,

    produto_id INT UNSIGNED NULL,

    nome_produto VARCHAR(150) NOT NULL,

    preco_unitario DECIMAL(10,2) NOT NULL,

    quantidade INT UNSIGNED NOT NULL,

    subtotal DECIMAL(10,2) NOT NULL,

    FOREIGN KEY (pedido_id)
        REFERENCES pedidos(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    FOREIGN KEY (produto_id)
        REFERENCES produtos(id)
        ON DELETE SET NULL
        ON UPDATE CASCADE,

    INDEX idx_pedido_itens_pedido (
        pedido_id
    )
);


-- ============================================================
-- PAGAMENTOS
-- ============================================================

CREATE TABLE pagamentos (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,

    pedido_id BIGINT UNSIGNED NOT NULL,

    metodo ENUM(
        'PIX',
        'DINHEIRO',
        'CARTAO'
    ) NOT NULL,

    status ENUM(
        'PENDENTE',
        'APROVADO',
        'RECUSADO',
        'CANCELADO'
    ) NOT NULL DEFAULT 'PENDENTE',

    valor DECIMAL(10,2) NOT NULL,

    transacao_id VARCHAR(255) NULL,

    criado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    atualizado_em TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (pedido_id)
        REFERENCES pedidos(id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    INDEX idx_pagamentos_pedido (
        pedido_id
    ),

    INDEX idx_pagamentos_transacao (
        transacao_id
    )
);
