// cardapio.js
// Cardápio simples em memória. Depois pode virar um JSON externo ou vir de um banco.
// "id" é o número que o cliente digita para escolher o item.

const CARDAPIO = [
  { id: 1, nome: "Sorvete 500ml Leite Condensado c/ Leite em Pó", preco: 22.0 },
  { id: 2, nome: "Sorvete 500ml Chocolate", preco: 20.0 },
  { id: 3, nome: "Sorvete 500ml Morango", preco: 20.0 },
  { id: 4, nome: "Sorvete 1L Napolitano", preco: 32.0 },
  { id: 5, nome: "Picolé Unidade", preco: 5.0 },
  { id: 6, nome: "Casquinha Simples", preco: 7.0 },
];

function formatarCardapio() {
  return CARDAPIO.map(
    (item) => `*${item.id}* - ${item.nome} - R$ ${item.preco.toFixed(2)}`
  ).join("\n");
}

function buscarItem(id) {
  return CARDAPIO.find((item) => item.id === Number(id));
}

module.exports = { CARDAPIO, formatarCardapio, buscarItem };
