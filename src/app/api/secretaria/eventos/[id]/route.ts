import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { listarEventoPorId } from "@/lib/secretaria-service";

/** Detalhe de um evento (procura em todas as agendas visíveis pelo token). */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return secretariaRoute(req, async (ctx) => {
    const { id } = await context.params;
    return listarEventoPorId(ctx, { id });
  });
}
