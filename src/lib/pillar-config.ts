import { Pillar } from "@/types/task";

export const CALENDAR_PILLAR_OVERRIDES: Record<string, Pillar> = {
  "TI CF Contabilidade": "trabalho",
  "Soluções Inteligentes": "trabalho",
  "DevPoint": "trabalho",
};

/** Calendários restritos a dias úteis / horário comercial. Match case-insensitive. */
export function isBusinessHoursCalendar(calendarName?: string): boolean {
  return (calendarName ?? "").toLowerCase().includes("cf contabilidade");
}
