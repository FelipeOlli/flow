import { FlowTask } from "@/types/task";
import { getDateKeyInTimeZone, diffDateKeysInDays } from "./timezone";

export function computeDaysOpen(task: FlowTask, tz: string): number {
  if (task.isComplete) return 0;
  // Eventos recorrentes: cada instância nasce na sua data de início — usar startTime
  // Eventos únicos: usar createdAt (data de criação no Google Calendar)
  const baseIso = task.isRecurring ? task.startTime : task.createdAt;
  if (!baseIso) return 0;
  const baseKey = getDateKeyInTimeZone(new Date(baseIso), tz);
  const todayKey = getDateKeyInTimeZone(new Date(), tz);
  return Math.max(0, diffDateKeysInDays(baseKey, todayKey));
}

export function agingBadgeColor(days: number): string {
  if (days >= 8) return "text-[#ea4335]";
  if (days >= 4) return "text-[#F6BF26]";
  return "text-white/60";
}
