import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { listarProximos } from "@/lib/secretaria-service";
import { DEFAULT_LIMIT } from "@/lib/secretaria";

/**
 * Eventos que começam dentro da janela informada.
 * Query: minutos=N (padrão 120) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, (ctx) =>
    listarProximos(ctx, {
      minutos: Number(req.nextUrl.searchParams.get("minutos") ?? 120),
      limite: Number(req.nextUrl.searchParams.get("limite") ?? DEFAULT_LIMIT),
      offset: Number(req.nextUrl.searchParams.get("offset") ?? 0),
      incluirFeriados: req.nextUrl.searchParams.get("incluir_feriados") === "true",
    })
  );
}
