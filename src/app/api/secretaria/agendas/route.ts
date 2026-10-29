import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { listarAgendas } from "@/lib/secretaria-service";

/** Lista as agendas visíveis pelo token (inclui compartilhadas só-leitura). */
export async function GET(req: NextRequest) {
  return secretariaRoute(req, (ctx) => listarAgendas(ctx));
}
