export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initCron } = await import("@/lib/cron");
      initCron();
    } catch (err) {
      console.error("[FLOW INSTRUMENTATION] Falha ao inicializar cron:", err);
    }

    // Setup idempotente do webhook do Telegram.
    try {
      const { ensureTelegramWebhook, ensureMyCommands } = await import("@/lib/telegram");
      const url = process.env.TELEGRAM_WEBHOOK_URL;
      const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
      if (url && secret) {
        await ensureTelegramWebhook({ url, secret });
      }
      await ensureMyCommands();
    } catch (err) {
      console.error("[FLOW INSTRUMENTATION] Falha ao configurar Telegram:", err);
    }
  }
}
