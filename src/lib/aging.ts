import { FlowTask } from "@/types/task";
import { getDateKeyInTimeZone, diffDateKeysInDays } from "./timezone";

export function computeDaysOpen(task: FlowTask, tz: string): number {
  if (!task.createdAt || task.isComplete) return 0;
  const createdKey = getDateKeyInTimeZone(new Date(task.createdAt), tz);
  const todayKey = getDateKeyInTimeZone(new Date(), tz);
  return Math.max(0, diffDateKeysInDays(createdKey, todayKey));
}

export function agingBadgeColor(days: number): string {
  if (days >= 8) return "text-[#ea4335]";
  if (days >= 4) return "text-[#F6BF26]";
  return "text-white/60";
}
