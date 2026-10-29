import { getEventsInRange } from "@/lib/google-calendar";
import { getDateKeyInTimeZone, getUtcRangeForDateKey, shiftDateKey } from "@/lib/timezone";
import { NextRequest } from "next/server";
import { secretariaRoute, HttpError } from "@/lib/secretaria-route";
import { findByResponsavel, paginate, toSecretariaEvent } from "@/lib/secretaria";

/**
 * Eventos delegados a uma pessoa (campo de delegação).
 * Query: pessoa=nome|email (obrigatório) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, async ({ accessToken, timeZone, params }) => {
    const pessoa = params.get("pessoa")?.trim();
    if (!pessoa) throw new HttpError(400, "`pessoa` é obrigatório");

    const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
    const { startUtc } = getUtcRangeForDateKey(shiftDateKey(todayKey, -180), timeZone);
    const { endUtc } = getUtcRangeForDateKey(shiftDateKey(todayKey, 60), timeZone);

    const tasks = await getEventsInRange(accessToken, startUtc, endUtc, timeZone);
    const encontrados = findByResponsavel(tasks, pessoa);

    const { dados, paginacao } = paginate(
      encontrados.map((t) => toSecretariaEvent(t, timeZone)),
      Number(params.get("limite") ?? 100),
      Number(params.get("offset") ?? 0)
    );

    return { dados, paginacao };
  });
}
