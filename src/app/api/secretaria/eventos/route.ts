import { getEventsInRange } from "@/lib/google-calendar";
import { getDateKeyInTimeZone, getUtcRangeForDateKey, diffDateKeysInDays, shiftDateKey } from "@/lib/timezone";
import { NextRequest } from "next/server";
import { secretariaRoute, HttpError } from "@/lib/secretaria-route";
import {
  DEFAULT_LIMIT,
  MAX_RANGE_DAYS,
  filterEvents,
  isDateKeyParam,
  paginate,
  parseStatusParam,
  toSecretariaEvent,
} from "@/lib/secretaria";

/**
 * Lista eventos por período, agenda e status.
 *
 * Query: de=YYYY-MM-DD · ate=YYYY-MM-DD · agenda=nome|Id · status=aberto,concluido
 *        limite=N (máx. 500) · offset=N · tz=timezone
 *
 * Sem `de`/`ate` o padrão é de 7 dias atrás a 60 dias à frente.
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, async ({ accessToken, timeZone, params }) => {
    const de = params.get("de");
    const ate = params.get("ate");
    if (de && !isDateKeyParam(de)) throw new HttpError(400, "`de` deve ser YYYY-MM-DD");
    if (ate && !isDateKeyParam(ate)) throw new HttpError(400, "`ate` deve ser YYYY-MM-DD");

    const agenda = params.get("agenda")?.trim() || undefined;
    const status = parseStatusParam(params.get("status")) ?? undefined;

    const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
    const fromKey = de ?? shiftDateKey(todayKey, -7);
    const toKey = ate ?? shiftDateKey(todayKey, 60);
    if (fromKey > toKey) throw new HttpError(400, "`de` não pode ser depois de `ate`");

    // Janela máxima: acima disso o Google vira a consulta em várias páginas
    // e a resposta demora demais.
    const dias = diffDateKeysInDays(fromKey, toKey);
    if (dias > MAX_RANGE_DAYS) {
      throw new HttpError(
        400,
        `Janela máxima de ${MAX_RANGE_DAYS} dias (pedido: ${dias}). Faça várias consultas.`
      );
    }

    const { startUtc, endUtc } = getUtcRangeForDateKey(fromKey, timeZone);
    const end = getUtcRangeForDateKey(toKey, timeZone).endUtc;

    const tasks = await getEventsInRange(accessToken, startUtc, end, timeZone);
    const filtered = filterEvents(tasks, {
      agenda,
      de: fromKey,
      ate: toKey,
      status,
      incluirFeriados: params.get("incluir_feriados") === "true",
      timeZone,
    });

    const sorted = [...filtered].sort(
      (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
    );
    const { dados, paginacao } = paginate(
      sorted.map((t) => toSecretariaEvent(t, timeZone)),
      Number(params.get("limite") ?? DEFAULT_LIMIT),
      Number(params.get("offset") ?? 0)
    );

    return { dados, paginacao };
  });
}
