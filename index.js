// ============================================================
// BOT DE ATENDIMENTO - SORVETERIA (WHATSAPP + ABACATEPAY)
// Ponto de Entrada Principal da Aplicação
// ============================================================

const { config, validarConfiguracao, verificarCardapio } = require("./src/config/config");
const { inicializarAbacatePay } = require("./src/services/abacatePayService");
const { client } = require("./src/services/whatsappService");
const { iniciarServidor } = require("./src/server/app");
const { processarMensagemRecebida } = require("./src/handlers/messageHandler");
const { mensagemJaProcessada } = require("./src/utils/idempotencia");

/**
 * Função de inicialização e orquestração do sistema.
 */
async function bootstrap() {
    try {
        console.log("================================");
        console.log("🚀 INICIANDO BOT DA SORVETERIA");
        console.log("================================");

        // 1. Validação das variáveis de ambiente e arquivos
        validarConfiguracao();
        console.log("✅ [App] Variáveis de ambiente validadas.");

        verificarCardapio();

        // 2. Inicialização do SDK AbacatePay
        await inicializarAbacatePay();

        // 3. Inicialização do servidor Webhook Express
        await iniciarServidor(config.server.port);

        // 4. Registro dos listeners de mensagem do WhatsApp
        client.on("message", async (msg) => {
            try {
                // Prevenção de mensagens duplicadas
                if (mensagemJaProcessada(msg)) {
                    console.log(`⚠️ [WhatsApp] Mensagem duplicada ignorada [${msg.id?.id}].`);
                    return;
                }

                // Ignora mensagens vindas de grupos (atendimento exclusivo no chat privado)
                if (msg.from && msg.from.endsWith("@g.us")) {
                    return;
                }

                // Ignora mensagens do próprio número de atendimento da loja
                if (msg.from === `${config.store.numero}@c.us`) {
                    return;
                }

                const chatId = msg.from;
                const texto = (msg.body || "").trim();

                console.log(`📩 [WhatsApp] Mensagem de ${chatId}: "${texto}"`);
                await processarMensagemRecebida(client, chatId, texto, msg);

            } catch (err) {
                console.error(`❌ [WhatsApp] Erro ao processar mensagem de ${msg.from}:`, err.message);
                try {
                    await client.sendMessage(
                        msg.from,
                        "Ops, tive um problema ao processar sua mensagem 😕\n\nPor favor, tente novamente ou digite *cancelar*."
                    );
                } catch (errEnvio) {
                    console.error("❌ [WhatsApp] Falha ao enviar mensagem de erro para o cliente:", errEnvio.message);
                }
            }
        });

        // 5. Inicialização do cliente WhatsApp
        console.log("📱 [WhatsApp] Inicializando cliente WhatsApp...");
        await client.initialize();

    } catch (err) {
        console.error("================================");
        console.error("❌ [App] ERRO FATAL AO INICIAR APLICAÇÃO:");
        console.error(err.message);
        console.error("================================");
        process.exit(1);
    }
}

// ============================================================
// TRATAMENTO GLOBAL DE ERROS E ENCERRAMENTO GRACIOSO
// ============================================================

process.on("unhandledRejection", (error) => {
    console.error("❌ [Process] Unhandled Rejection capturado:", error);
});

process.on("uncaughtException", (error) => {
    console.error("❌ [Process] Uncaught Exception capturado:", error);
});

process.on("SIGINT", async () => {
    console.log("\n🛑 [Process] Encerrando bot de forma graciosa...");
    try {
        if (client) await client.destroy();
    } catch (_) {}
    process.exit(0);
});

process.on("SIGTERM", async () => {
    console.log("\n🛑 [Process] Encerrando bot de forma graciosa...");
    try {
        if (client) await client.destroy();
    } catch (_) {}
    process.exit(0);
});

// Inicia a aplicação
bootstrap();
