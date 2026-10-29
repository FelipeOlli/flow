import { getEventFromAnyCalendar } from "@/lib/google-calendar";
import { NextRequest } from "next/server";
import { secretariaRoute, HttpError } from "@/lib/secretaria-route";
import { toSecretariaEvent } from "@/lib/secretaria";

/** Detalhe de um evento (procura em todas as agendas visíveis pelo token). */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return secretariaRoute(req, async ({ accessToken, timeZone }) => {
    const { id } = await context.params;
    const task = await getEventFromAnyCalendar(accessToken, id);
    if (!task) throw new HttpError(404, "Evento não encontrado");
    return { evento: toSecretariaEvent(task, timeZone) };
  });
}
