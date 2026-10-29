import { getEventsInRange } from "@/lib/google-calendar";
import { NextRequest } from "next/server";
import { secretariaRoute, HttpError } from "@/lib/secretaria-route";
import { findUpcoming, paginate, toSecretariaEvent } from "@/lib/secretaria";

/**
 * Eventos que começam dentro da janela informada.
 * Query: minutos=N (padrão 120) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, async ({ accessToken, timeZone, params }) => {
    const minutosRaw = Number(params.get("minutos") ?? 120);
    if (!Number.isFinite(minutosRaw) || minutosRaw <= 0) {
      throw new HttpError(400, "`minutos` deve ser um número positivo");
    }
    const minutos = Math.min(Math.floor(minutosRaw), 60 * 24 * 7);

    const now = new Date();
    // Busca desde 1h atrás pra não perder evento que começa na borda da janela.
    const searchStart = new Date(now.getTime() - 60 * 60_000);
    const searchEnd = new Date(now.getTime() + minutos * 60_000);

    const tasks = await getEventsInRange(accessToken, searchStart, searchEnd, timeZone);
    const upcoming = findUpcoming(
      tasks,
      now.getTime(),
      minutos,
      timeZone,
      params.get("incluir_feriados") === "true"
    );

    const { dados, paginacao } = paginate(
      upcoming.map((t) => toSecretariaEvent(t, timeZone)),
      Number(params.get("limite") ?? 100),
      Number(params.get("offset") ?? 0)
    );

    return { dados, paginacao };
  });
}
