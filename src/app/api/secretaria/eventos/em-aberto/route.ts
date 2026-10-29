import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { listarEmAberto } from "@/lib/secretaria-service";
import { DEFAULT_LIMIT } from "@/lib/secretaria";

/**
 * Eventos em aberto: vencidos (início já passou) ou parados há X dias.
 * Query: dias_parado=N (padrão 7) · limite=N · offset=N
 */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, (ctx) =>
    listarEmAberto(ctx, {
      diasParado: Number(req.nextUrl.searchParams.get("dias_parado") ?? 7),
      limite: Number(req.nextUrl.searchParams.get("limite") ?? DEFAULT_LIMIT),
      offset: Number(req.nextUrl.searchParams.get("offset") ?? 0),
      incluirFeriados: req.nextUrl.searchParams.get("incluir_feriados") === "true",
    })
  );
}
