import * as fs from "fs";
import cron from "node-cron";
import { runMigration } from "./migration";
import { getValidAccessToken } from "./token-store";
import { setMigrationError, setMigrationRunning, setMigrationSuccess } from "./migration-status";
import { sendDueNotifications } from "./notifier";
import {
  getDateKeyInTimeZone,
  getReferenceDateForDateKey,
  getTimePartsInTimeZone,
  shiftDateKey,
} from "./timezone";

const CRON_STATE_PATH = "/app/data/.migration-cron-state.json";
const CATCHUP_MAX_DAYS = 30;

function loadLastRunDate(): string | null {
  try {
    const data = JSON.parse(fs.readFileSync(CRON_STATE_PATH, "utf-8"));
    return typeof data.lastRunDate === "string" ? data.lastRunDate : null;
  } catch {
    return null;
  }
}

function saveLastRunDate(dateKey: string) {
  try {
    fs.writeFileSync(CRON_STATE_PATH, JSON.stringify({ lastRunDate: dateKey }));
  } catch (err) {
    console.error("[FLOW CRON] Erro ao salvar estado da migração:", err);
  }
}

/**
 * Runs a single migration step.
 * When fromDateKey/toDateKey are provided, migrates that specific range.
 * Without them, migrates yesterday → today (default cron behavior).
 */
async function runNightlyMigration(
  timeZone: string,
  label: string,
  fromDateKey?: string,
  toDateKey?: string
) {
  const startedAt = new Date().toISOString();
  console.log(`[FLOW CRON] [${startedAt}] ${label}`);
  setMigrationRunning("auto");

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    const message = "Token indisponível. Faça login no FLOW para ativar a migração.";
    setMigrationError("auto", message);
    console.error(`[FLOW CRON] [${new Date().toISOString()}] ${message}`);
    return;
  }

  const fromDate = fromDateKey ? getReferenceDateForDateKey(fromDateKey, timeZone) : undefined;
  const toDate = toDateKey ? getReferenceDateForDateKey(toDateKey, timeZone) : undefined;

  try {
    const result = await runMigration(accessToken, timeZone, fromDate, toDate);
    setMigrationSuccess("auto", result);
    saveLastRunDate(result.diagnostics.targetDateKey);
    if (result.migrated === 0 && result.skipped === 0) {
      const d = result.diagnostics;
      console.log(
        `[FLOW CRON] [${new Date().toISOString()}] Fila vazia: ` +
          `source=${d.sourceDateKey}, target=${d.targetDateKey}, ` +
          `sourceEvents=${d.sourceEvents}, pendingTimed=${d.pendingEvents}, ` +
          `eligibleTimed=${d.eligibleTimed}, eligibleAllDay=${d.eligibleAllDay}`
      );
    } else {
      console.log(
        `[FLOW CRON] [${new Date().toISOString()}] Migração concluída: ` +
          `${result.migrated} migradas, ${result.skipped} ignoradas`
      );
    }
  } catch (err) {
    setMigrationError("auto", err);
    console.error(`[FLOW CRON] [${new Date().toISOString()}] Erro na migração:`, err);
  }
}

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

  const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  try {
    cron.schedule(
      "1 0 * * *",
      () => runNightlyMigration(timeZone, "Iniciando migração noturna..."),
      { timezone: "America/Sao_Paulo" }
    );

    cron.schedule(
      "* * * * *",
      async () => {
        try {
          const token = await getValidAccessToken();
          if (token) await sendDueNotifications(token, timeZone);
        } catch (err) {
          console.error("[FLOW CRON] Erro no tick de notificações:", err);
        }
      },
      { timezone: "America/Sao_Paulo" }
    );

    cronScheduled = true;
    cronInitError = null;
    console.log("[FLOW CRON] Migração noturna agendada para 00:01 (America/Sao_Paulo)");
    console.log("[FLOW CRON] Notificações push agendadas a cada minuto.");
    console.log("[FLOW CRON] Recomendado em produção: cron externo chamando POST /api/cron/migrate às 00:01.");
  } catch (err) {
    cronScheduled = false;
    cronInitError = err instanceof Error ? err.message : String(err);
    console.error("[FLOW CRON] Falha ao agendar migração noturna:", err);
  }

  // Catch-up: se o app reiniciou após 00:01 e há dias sem migração registrada,
  // executa sequencialmente cada dia perdido para trazer os eventos até hoje.
  const now = new Date();
  const todayDateKey = getDateKeyInTimeZone(now, timeZone);
  const { hour, minute } = getTimePartsInTimeZone(now, timeZone);
  const pastMidnight = hour > 0 || minute >= 1;
  const lastRunDate = loadLastRunDate();

  if (pastMidnight && lastRunDate !== todayDateKey) {
    // Compute all missed target dates: from (lastRunDate + 1) up to todayDateKey
    const missedDays: Array<{ from: string; to: string }> = [];
    const startDateKey = lastRunDate ? shiftDateKey(lastRunDate, 1) : todayDateKey;
    let cursor = startDateKey;
    while (cursor <= todayDateKey && missedDays.length < CATCHUP_MAX_DAYS) {
      missedDays.push({ from: shiftDateKey(cursor, -1), to: cursor });
      cursor = shiftDateKey(cursor, 1);
    }

    console.log(
      `[FLOW CRON] Catch-up detectado: última migração registrada=${lastRunDate ?? "nunca"}, ` +
        `hoje=${todayDateKey}. Dias a recuperar: ${missedDays.map((d) => d.to).join(", ")}`
    );

    setImmediate(async () => {
      for (const { from, to } of missedDays) {
        await runNightlyMigration(timeZone, `Catch-up: ${from} → ${to}`, from, to);
      }
    });
  }
}
