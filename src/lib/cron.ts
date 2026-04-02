import cron from "node-cron";
import { runMigration } from "./migration";
import { getValidAccessToken } from "./token-store";
import { setMigrationError, setMigrationRunning, setMigrationSuccess } from "./migration-status";

let initialized = false;

export function initCron() {
  if (initialized) return;
  initialized = true;

  if (!process.env.CRON_SECRET) {
    console.warn("[FLOW CRON] CRON_SECRET não definido. Recomendado configurar cron externo para produção.");
  }

  cron.schedule(
    "1 0 * * *",
    async () => {
      const startedAt = new Date().toISOString();
      console.log(`[FLOW CRON] [${startedAt}] Iniciando migração noturna...`);
      setMigrationRunning("auto");

      const accessToken = await getValidAccessToken();
      if (!accessToken) {
        const message = "Token indisponível. Faça login no FLOW para ativar a migração.";
        setMigrationError("auto", message);
        console.error(`[FLOW CRON] [${new Date().toISOString()}] ${message}`);
        return;
      }

      const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

      try {
        const result = await runMigration(accessToken, timeZone);
        setMigrationSuccess("auto", result);
        console.log(
          `[FLOW CRON] [${new Date().toISOString()}] Migração concluída: ` +
            `${result.migrated} migradas, ${result.skipped} ignoradas`
        );
      } catch (err) {
        setMigrationError("auto", err);
        console.error(`[FLOW CRON] [${new Date().toISOString()}] Erro na migração:`, err);
      }
    },
    { timezone: "America/Sao_Paulo" }
  );

  console.log("[FLOW CRON] Migração noturna agendada para 00:01");
  console.log("[FLOW CRON] Recomendado em produção: cron externo chamando POST /api/cron/migrate às 00:01.");
}
