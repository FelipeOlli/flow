/**
 * Lembrete por evento — notificador próprio do Flow (Web Push + Telegram),
 * não usa o `reminders` nativo do Google Calendar. Persistido em
 * `extendedProperties.private.flowReminderMinutes`.
 *
 * Valores:
 * - ausente (undefined) → default do Flow (DEFAULT_REMINDER_MINUTES)
 * - null → sem lembrete
 * - number → minutos antes do início
 */

export const DEFAULT_REMINDER_MINUTES = 5;

export const REMINDER_OPTIONS: { value: number | null; label: string }[] = [
  { value: null, label: "Sem lembrete" },
  { value: 5, label: "5 min" },
  { value: 10, label: "10 min" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 h" },
  { value: 120, label: "2 h" },
  { value: 1440, label: "1 dia" },
];

export function parseReminderProp(raw?: string): number | null | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "none") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function serializeReminder(value: number | null | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return "none";
  return String(value);
}

export function formatReminderLead(minutes: number): string {
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const days = minutes / 1440;
    return days === 1 ? "1 dia" : `${days} dias`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return hours === 1 ? "1 h" : `${hours} h`;
  }
  return `${minutes} min`;
}
