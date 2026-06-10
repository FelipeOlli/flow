import fs from "fs";
import path from "path";
import webpush from "web-push";
import { getEventsForDateKey } from "./google-calendar";
import { getDateKeyInTimeZone } from "./timezone";
import { listSubscriptions, removeSubscription } from "./push-store";

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

export async function sendDueNotifications(accessToken: string, timeZone: string): Promise<void> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) return;

  const subs = listSubscriptions();
  if (subs.length === 0) return;

  webpush.setVapidDetails(subject, publicKey, privateKey);

  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const notified = loadNotifiedToday(todayKey);

  // janela: eventos que começam entre 9 e 11 minutos a partir de agora
  const windowStart = new Date(now.getTime() + 9 * 60 * 1000);
  const windowEnd = new Date(now.getTime() + 11 * 60 * 1000);

  let tasks;
  try {
    tasks = await getEventsForDateKey(accessToken, todayKey, timeZone);
  } catch (err) {
    console.error("[NOTIFIER] Erro ao buscar eventos:", err);
    return;
  }

  const due = tasks.filter((t) => {
    if (notified.has(t.id)) return false;
    if (t.isComplete) return false;
    if (t.isCancelled) return false;
    if (t.selfResponseStatus === "declined") return false;
    if (!t.startTime || t.isAllDay) return false;

    const start = new Date(t.startTime);
    return start >= windowStart && start <= windowEnd;
  });

  if (due.length === 0) return;

  for (const task of due) {
    const start = new Date(task.startTime);
    const timeStr = start.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone,
    });

    const payload = JSON.stringify({
      title: task.title,
      body: `Começa às ${timeStr}${task.calendarName ? ` • ${task.calendarName}` : ""}`,
      tag: `flow-event-${task.id}`,
      url: "/today",
    });

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

    notified.add(task.id);
    console.log(`[NOTIFIER] Notificação enviada: "${task.title}" às ${timeStr}`);
  }

  saveNotifiedToday(todayKey, notified);
}
