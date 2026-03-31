import cron from "node-cron";
import { runMigration } from "./migration";
import { getValidAccessToken } from "./token-store";

let initialized = false;

export function initCron() {
  if (initialized) return;
  initialized = true;

  cron.schedule(
    "1 0 * * *",
    async () => {
      console.log("[FLOW CRON] Iniciando migração noturna...");

      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        console.error("[FLOW CRON] Token indisponível. Faça login no FLOW para ativar a migração.");
        return;
      }

      const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

      try {
        const result = await runMigration(accessToken, timeZone);
        console.log(`[FLOW CRON] Migração concluída: ${result.migrated} migradas, ${result.skipped} ignoradas`);
      } catch (err) {
        console.error("[FLOW CRON] Erro na migração:", err);
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  console.log("[FLOW CRON] Migração noturna agendada para 00:01");
}
