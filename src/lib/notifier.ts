import fs from "fs";
import path from "path";
import webpush from "web-push";
import { getEventsForDateKey } from "./google-calendar";
import { getDateKeyInTimeZone, shiftDateKey } from "./timezone";
import { listSubscriptions, removeSubscription } from "./push-store";
import { sendTelegramMessage } from "./telegram";
import { DEFAULT_REMINDER_MINUTES, formatReminderLead } from "./reminder";
import type { FlowTask } from "@/types/task";

const DATA_DIR =
  process.env.NODE_ENV === "production" ? "/app/data" : process.cwd();

const NOTIFIED_FILE = path.join(DATA_DIR, ".notified-today.json");

function loadNotifiedToday(todayKey: string): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(NOTIFIED_FILE, "utf-8"));
    if (data.date === todayKey && Array.isArray(data.ids)) {
      return new Set<string>(data.ids);
    }
  } catch { /* ignore */ }
  return new Set<string>();
}

function saveNotifiedToday(todayKey: string, ids: Set<string>): void {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(NOTIFIED_FILE, JSON.stringify({ date: todayKey, ids: Array.from(ids) }), "utf-8");
  } catch (err) {
    console.error("[NOTIFIER] Falha ao salvar notified-today:", err);
  }
}

async function sendPushNotification(
  subs: ReturnType<typeof listSubscriptions>,
  title: string,
  body: string,
  tag: string,
): Promise<void> {
  const payload = JSON.stringify({ title, body, tag, url: "/today" });

  for (const sub of subs) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload);
    } catch (err: unknown) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404) {
        removeSubscription(sub.endpoint);
        console.log(`[NOTIFIER] Subscription expirada removida: ${sub.endpoint.slice(0, 60)}…`);
      }
    }
  }
}

export async function sendDueNotifications(accessToken: string, timeZone: string): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  const subs = listSubscriptions();
  const pushEnabled = !!(publicKey && privateKey && subject) && subs.length > 0;

  if (pushEnabled) {
    webpush.setVapidDetails(subject!, publicKey!, privateKey!);
  }

  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const notified = loadNotifiedToday(todayKey);

  // Busca hoje e amanhã: lembrete de "1 dia antes" dispara na véspera, com o
  // evento ainda listado no dia seguinte.
  let tasks: FlowTask[];
  try {
    const tomorrowKey = shiftDateKey(todayKey, 1);
    const [todayTasks, tomorrowTasks] = await Promise.all([
      getEventsForDateKey(accessToken, todayKey, timeZone),
      getEventsForDateKey(accessToken, tomorrowKey, timeZone),
    ]);
    tasks = [...todayTasks, ...tomorrowTasks];
  } catch (err) {
    console.error("[NOTIFIER] Erro ao buscar eventos:", err);
    return;
  }

  // Filtros comuns
  const eligible = tasks.filter(
    (t) => !t.isComplete && !t.isCancelled && t.selfResponseStatus !== "declined" && t.startTime && !t.isAllDay,
  );

  if (eligible.length === 0) return;

  // Janela de disparo: o cron roda a cada minuto, então ±1 min do instante exato do lembrete
  const windowStart = new Date(now.getTime() - 60 * 1000);
  const windowEnd = new Date(now.getTime() + 60 * 1000);

  let sent = false;

  for (const task of eligible) {
    // reminderMinutes: undefined = default do Flow, null = lembrete desligado
    if (task.reminderMinutes === null) continue;
    const minutes = task.reminderMinutes ?? DEFAULT_REMINDER_MINUTES;

    const eventStart = new Date(task.startTime!);
    const fireAt = new Date(eventStart.getTime() - minutes * 60 * 1000);
    if (fireAt < windowStart || fireAt > windowEnd) continue;

    const timeStr = eventStart.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    const calendarSuffix = task.calendarName ? ` • ${task.calendarName}` : "";

    // Chave inclui startTime e minutos: rearma se o evento mudar de horário ou o lembrete mudar
    const key = `${task.id}@${task.startTime}#${minutes}`;
    if (notified.has(key)) continue;

    const lead = formatReminderLead(minutes);
    const pushBody = `Começa às ${timeStr}${calendarSuffix}`;
    const telegramText = `⏰ <b>Em ${lead}:</b> ${task.title}\nComeça às ${timeStr}${calendarSuffix}`;

    if (pushEnabled) {
      await sendPushNotification(subs, task.title, pushBody, `flow-event-${task.id}`);
    }
    await sendTelegramMessage(telegramText);

    notified.add(key);
    sent = true;
    console.log(`[NOTIFIER] Lembrete (${lead}): "${task.title}" às ${timeStr}`);
  }

  if (sent) {
    saveNotifiedToday(todayKey, notified);
  }
}
