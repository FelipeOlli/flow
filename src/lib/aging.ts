import { FlowTask } from "@/types/task";
import { getDateKeyInTimeZone, diffDateKeysInDays } from "./timezone";

export function categoryLetters(task: FlowTask): { letter: string; color: string }[] {
  if (task.isComplete) return [];
  const result: { letter: string; color: string }[] = [];
  if (task.category === "operational") result.push({ letter: "O", color: "text-white/50" });
  if (task.category === "strategic") result.push({ letter: "E", color: "text-[#a78bfa]" });
  if (task.isDelegable) result.push({ letter: "D", color: "text-[#4dd0e1]" });
  return result;
}

export function computeDaysOpen(task: FlowTask, tz: string): number {
  if (task.isComplete) return 0;
  if (!task.startTime) return 0;
  const baseKey = getDateKeyInTimeZone(new Date(task.startTime), tz);
  const todayKey = getDateKeyInTimeZone(new Date(), tz);
  return Math.max(0, diffDateKeysInDays(baseKey, todayKey));
}

export function agingBadgeColor(days: number): string {
  if (days >= 8) return "text-[#ea4335]";
  if (days >= 4) return "text-[#F6BF26]";
  return "text-white/60";
}
