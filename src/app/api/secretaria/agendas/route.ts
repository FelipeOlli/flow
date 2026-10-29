import { listReadableCalendars } from "@/lib/google-calendar";
import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";

/** Lista as agendas visíveis pelo token (inclui compartilhadas só-leitura). */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, async ({ accessToken }) => {
    const agendas = await listReadableCalendars(accessToken);
    return {
      agendas: agendas.map((a) => ({
        id: a.id,
        nome: a.name,
        cor: a.bgColor ?? null,
      })),
    };
  });
}
