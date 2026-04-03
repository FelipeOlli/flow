export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { initCron } = await import("@/lib/cron");
      initCron();
    } catch (err) {
      console.error("[FLOW INSTRUMENTATION] Falha ao inicializar cron:", err);
    }
  }
}
