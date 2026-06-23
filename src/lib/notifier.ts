import fs from "fs";
import path from "path";
import webpush from "web-push";
import { getEventsForDateKey } from "./google-calendar";
import { getDateKeyInTimeZone } from "./timezone";
import { listSubscriptions, removeSubscription } from "./push-store";
import { sendTelegramMessage } from "./telegram";
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

  let tasks: FlowTask[];
  try {
    tasks = await getEventsForDateKey(accessToken, todayKey, timeZone);
  } catch (err) {
    console.error("[NOTIFIER] Erro ao buscar eventos:", err);
    return;
  }

  // Filtros comuns a ambos os gatilhos
  const eligible = tasks.filter(
    (t) => !t.isComplete && !t.isCancelled && t.selfResponseStatus !== "declined" && t.startTime && !t.isAllDay,
  );

  if (eligible.length === 0) return;

  // Janela pré-aviso: 9–11 min antes
  const preStart = new Date(now.getTime() + 9 * 60 * 1000);
  const preEnd = new Date(now.getTime() + 11 * 60 * 1000);

  // Janela de início: -1 a +1 min
  const startWindowStart = new Date(now.getTime() - 1 * 60 * 1000);
  const startWindowEnd = new Date(now.getTime() + 1 * 60 * 1000);

  let sent = false;

  for (const task of eligible) {
    const eventStart = new Date(task.startTime!);
    const timeStr = eventStart.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });
    const calendarSuffix = task.calendarName ? ` • ${task.calendarName}` : "";

    // --- Pré-aviso (~10 min antes) ---
    // Chave inclui startTime: rearma se o evento for movido para outro horário
    const preKey = `${task.id}@${task.startTime}`;
    if (!notified.has(preKey) && eventStart >= preStart && eventStart <= preEnd) {
      const pushBody = `Começa às ${timeStr}${calendarSuffix}`;
      const telegramText = `⏰ <b>Em ~10 min:</b> ${task.title}\nComeça às ${timeStr}${calendarSuffix}`;

      if (pushEnabled) {
        await sendPushNotification(subs, task.title, pushBody, `flow-event-${task.id}`);
      }
      await sendTelegramMessage(telegramText);

      notified.add(preKey);
      sent = true;
      console.log(`[NOTIFIER] Pré-aviso: "${task.title}" às ${timeStr}`);
    }

    // --- Na hora (início do evento) ---
    const startKey = `${task.id}@${task.startTime}:start`;
    if (!notified.has(startKey) && eventStart >= startWindowStart && eventStart <= startWindowEnd) {
      const pushBody = `Começou às ${timeStr}${calendarSuffix}`;
      const telegramText = `🔔 <b>Agora:</b> ${task.title}\nComecou às ${timeStr}${calendarSuffix}`;

      if (pushEnabled) {
        await sendPushNotification(subs, `Agora: ${task.title}`, pushBody, `flow-event-${task.id}-start`);
      }
      await sendTelegramMessage(telegramText);

      notified.add(startKey);
      sent = true;
      console.log(`[NOTIFIER] Início: "${task.title}" às ${timeStr}`);
    }
  }

  if (sent) {
    saveNotifiedToday(todayKey, notified);
  }
}
