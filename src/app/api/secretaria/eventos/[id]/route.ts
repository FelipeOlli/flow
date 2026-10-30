import { NextRequest } from "next/server";
import { secretariaRoute } from "@/lib/secretaria-route";
import { atualizarEvento, listarEventoPorId } from "@/lib/secretaria-service";
import type { ParamsAtualizarEvento } from "@/lib/secretaria-backend";

/** Detalhe de um evento (procura em todas as agendas visíveis pelo token). */
export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return secretariaRoute(req, async (ctx) => {
    const { id } = await context.params;
    return listarEventoPorId(ctx, { id });
  });
}

/**
 * Atualiza um evento (Fase 4) — ou marca como concluído (`acao: "concluir"`).
 *
 * Exige o token de escrita (`FLOW_API_WRITE_TOKEN`).
 */
export async function PATCH(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return secretariaRoute(
    req,
    async (ctx) => {
      const { id } = await context.params;
      const body = (await req.json()) as Omit<ParamsAtualizarEvento, "id">;
      return atualizarEvento(ctx, { ...body, id });
    },
    { exigirEscrita: true }
  );
}
