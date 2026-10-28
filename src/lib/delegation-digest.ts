import fs from "fs";
import path from "path";
import { getEventsInRange } from "./google-calendar";
import { getDateKeyInTimeZone } from "./timezone";
import { groupDelegations } from "./delegation";
import { escapeHtml } from "./telegram-bot/formatter";
import { sendTelegramMessage } from "./telegram";
import type { FlowTask } from "@/types/task";

const DATA_DIR = process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();
const STATE_FILE = path.join(DATA_DIR, ".delegation-digest-state.json");

const BACK_DAYS = 180;
const FORWARD_DAYS = 60;

function readState(): { lastSentDate?: string } {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeState(dateKey: string): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify({ lastSentDate: dateKey }), "utf-8");
  } catch (err) {
    console.error("[DELEGATION DIGEST] Falha ao salvar estado:", err);
  }
}

function formatDue(dueDateKey: string): string {
  return `${dueDateKey.slice(8, 10)}/${dueDateKey.slice(5, 7)}`;
}

/**
 * Resumo diário das delegações atrasadas, enviado no Telegram.
 * Sem estado salvo no dia, não reenvia (protege contra reinício do container).
 */
export async function sendDelegationDigest(
  accessToken: string,
  timeZone: string
): Promise<void> {
  if (!process.env.TELEGRAM_CHAT_ID) return;

  const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
  if (readState().lastSentDate === todayKey) return;

  const startDate = new Date();
  startDate.setDate(startDate.getDate() - BACK_DAYS);
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + FORWARD_DAYS);

  const tasks: FlowTask[] = await getEventsInRange(accessToken, startDate, endDate, timeZone);
  const delegated = tasks.filter(
    (t) => !t.isCancelled && !t.isComplete && !!t.delegateTo?.email
  );

  const groups = groupDelegations(delegated, timeZone).filter((g) => g.overdue.length > 0);
  if (groups.length === 0) {
    writeState(todayKey);
    return;
  }

  const total = groups.reduce((sum, g) => sum + g.overdue.length, 0);
  const body = groups
    .map((group) => {
      const items = group.overdue
        .map((item) => {
          const late = item.daysLate === 1 ? "1 dia" : `${item.daysLate} dias`;
          return `  • ${escapeHtml(item.task.title)} — venceu ${formatDue(item.dueDateKey)} (há ${late})`;
        })
        .join("\n");
      const count = group.overdue.length === 1 ? "1 atrasada" : `${group.overdue.length} atrasadas`;
      return `<b>${escapeHtml(group.name)}</b> — ${count}\n${items}`;
    })
    .join("\n\n");

  await sendTelegramMessage(
    `<b>🔴 Cobrança: ${total} ${total === 1 ? "delegação atrasada" : "delegações atrasadas"}</b>\n\n${body}`
  );
  writeState(todayKey);
}
