import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { criarEvento, listarEventos } from "@/lib/secretaria-service";
import { DEFAULT_LIMIT } from "@/lib/secretaria";
import type { ParamsCriarEvento } from "@/lib/secretaria-backend";

/**
 * Lista eventos por período, agenda e status.
 *
 * Query: de=YYYY-MM-DD · ate=YYYY-MM-DD · agenda=nome|Id · status=aberto,concluido
 *        limite=N (máx. 500) · offset=N · tz=timezone
 *
 * Sem `de`/`ate` o padrão é de 7 dias atrás a 60 dias à frente.
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, (ctx) =>
    listarEventos(ctx, {
      de: req.nextUrl.searchParams.get("de") ?? undefined,
      ate: req.nextUrl.searchParams.get("ate") ?? undefined,
      agenda: req.nextUrl.searchParams.get("agenda") ?? undefined,
      status: req.nextUrl.searchParams.get("status") ?? undefined,
      limite: Number(req.nextUrl.searchParams.get("limite") ?? DEFAULT_LIMIT),
      offset: Number(req.nextUrl.searchParams.get("offset") ?? 0),
      incluirFeriados: req.nextUrl.searchParams.get("incluir_feriados") === "true",
    })
  );
}

/**
 * Cria um evento (Fase 4).
 *
 * Exige o token de escrita (`FLOW_API_WRITE_TOKEN`) — o token de leitura não
 * passa. Body no mesmo formato do service: titulo, data, horaInicio, ...
 */
export async function POST(req: NextRequest) {
  return secretariaRoute(
    req,
    async (ctx) => {
      const body = (await req.json()) as ParamsCriarEvento;
      return criarEvento(ctx, body);
    },
    { exigirEscrita: true }
  );
}
