import cron from "node-cron";
import { runMigration } from "./migration";
import { getValidAccessToken } from "./token-store";
import { setMigrationError, setMigrationRunning, setMigrationSuccess } from "./migration-status";

let initialized = false;
let cronScheduled = false;
let cronInitError: string | null = null;

export function isCronInitialized(): boolean {
  return cronScheduled;
}

export function getCronInitError(): string | null {
  return cronInitError;
}

export function initCron() {
  if (initialized) return;
  initialized = true;

  if (!process.env.CRON_SECRET) {
    console.warn("[FLOW CRON] CRON_SECRET não definido. Recomendado configurar cron externo para produção.");
  }
  // node-cron só roda com processo Node long-running (ex.: Docker). Em ambientes serverless,
  // agende POST /api/cron/migrate com Authorization: Bearer CRON_SECRET e token persistido em /app/data.

  try {
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
          if (result.migrated === 0 && result.skipped === 0) {
            const d = result.diagnostics;
            console.log(
              `[FLOW CRON] [${new Date().toISOString()}] Fila vazia: ` +
                `source=${d.sourceDateKey}, target=${d.targetDateKey}, ` +
                `sourceEvents=${d.sourceEvents}, pendingTimed=${d.pendingEvents}, ` +
                `eligibleTimed=${d.eligibleTimed}, eligibleAllDay=${d.eligibleAllDay}`
            );
          }
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

    cronScheduled = true;
    cronInitError = null;
    console.log("[FLOW CRON] Migração noturna agendada para 00:01 (America/Sao_Paulo)");
    console.log("[FLOW CRON] Recomendado em produção: cron externo chamando POST /api/cron/migrate às 00:01.");
  } catch (err) {
    cronScheduled = false;
    cronInitError = err instanceof Error ? err.message : String(err);
    console.error("[FLOW CRON] Falha ao agendar migração noturna:", err);
  }
}
