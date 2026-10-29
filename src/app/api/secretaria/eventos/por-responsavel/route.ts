import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { listarPorResponsavel } from "@/lib/secretaria-service";
import { DEFAULT_LIMIT } from "@/lib/secretaria";

/**
 * Eventos delegados a uma pessoa (campo de delegação).
 * Query: pessoa=nome|email (obrigatório) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, (ctx) =>
    listarPorResponsavel(ctx, {
      pessoa: req.nextUrl.searchParams.get("pessoa") ?? "",
      limite: Number(req.nextUrl.searchParams.get("limite") ?? DEFAULT_LIMIT),
      offset: Number(req.nextUrl.searchParams.get("offset") ?? 0),
      incluirFeriados: req.nextUrl.searchParams.get("incluir_feriados") === "true",
    })
  );
}
