"use client";

import { useRouter } from "next/navigation";
import { format, addDays, subDays, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";

interface DateHeaderProps {
  currentDate: Date;
}

export function DateHeader({ currentDate }: DateHeaderProps) {
  const router = useRouter();
  const date = new Date(currentDate);

  function navigate(direction: "prev" | "next") {
    const newDate = direction === "prev" ? subDays(date, 1) : addDays(date, 1);
    const formatted = format(newDate, "yyyy-MM-dd");
    router.push(`/today?date=${formatted}`);
  }

  const isCurrentDay = isToday(date);

  return (
    <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
      <div className="flex items-center justify-between px-4 py-4">
        <button
          onClick={() => navigate("prev")}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-800 active:bg-gray-700 transition-colors"
          aria-label="Dia anterior"
        >
          <ChevronLeftIcon />
        </button>

        <div className="text-center flex-1">
          <div className="flex items-center justify-center gap-2">
            <p className="text-lg font-semibold text-white capitalize">
              {isCurrentDay
                ? "Hoje"
                : format(date, "EEEE", { locale: ptBR })}
            </p>
            {isCurrentDay && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </div>
          <p className="text-sm text-gray-500">
            {format(date, "d 'de' MMMM, yyyy", { locale: ptBR })}
          </p>
        </div>

        <button
          onClick={() => navigate("next")}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-800 active:bg-gray-700 transition-colors"
          aria-label="Próximo dia"
        >
          <ChevronRightIcon />
        </button>
      </div>
    </div>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}
