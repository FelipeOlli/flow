import { getEventsInRange } from "@/lib/google-calendar";
import { getDateKeyInTimeZone, getUtcRangeForDateKey, shiftDateKey } from "@/lib/timezone";
import { NextRequest } from "next/server";
import { secretariaRoute, HttpError } from "@/lib/secretaria-route";
import { findOpenTasks, paginate, toSecretariaEvent } from "@/lib/secretaria";

/**
 * Eventos em aberto: vencidos (início já passou) ou parados há X dias.
 * Query: dias_parado=N (padrão 7) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, async ({ accessToken, timeZone, params }) => {
    const diasRaw = Number(params.get("dias_parado") ?? 7);
    if (!Number.isFinite(diasRaw) || diasRaw < 0) {
      throw new HttpError(400, "`dias_parado` deve ser um número >= 0");
    }
    const diasParado = Math.floor(diasRaw);

    // Janela ampla: atrasos antigos ainda importam para a cobrança.
    const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
    const fromKey = shiftDateKey(todayKey, -180);
    const toKey = shiftDateKey(todayKey, 60);
    const { startUtc } = getUtcRangeForDateKey(fromKey, timeZone);
    const { endUtc } = getUtcRangeForDateKey(toKey, timeZone);

    const tasks = await getEventsInRange(accessToken, startUtc, endUtc, timeZone);
    const abertos = findOpenTasks(tasks, Date.now(), diasParado, timeZone);

    const { dados, paginacao } = paginate(
      abertos.map((t) => toSecretariaEvent(t, timeZone)),
      Number(params.get("limite") ?? 100),
      Number(params.get("offset") ?? 0)
    );

    return { dados, paginacao };
  });
}
